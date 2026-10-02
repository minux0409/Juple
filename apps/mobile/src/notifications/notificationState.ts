import { useSyncExternalStore } from 'react';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getUnreadNotificationCount } from './notificationsApi';

/**
 * App-wide notification state that several places read and write: the bell's unread total, and the
 * "a Collection's 새 링크 were just read" signal the Collections list patches its card with. Module
 * level (not React state) because writers include the FCM listeners and the tap handler, which have
 * no component of their own. Never persisted - the server's count is the truth; this only mirrors it.
 */
type Listener = () => void;

let unreadCount: number | null = null;
let refreshGeneration = 0;
const unreadListeners = new Set<Listener>();

function emitUnread(): void {
  for (const listener of [...unreadListeners]) {
    listener();
  }
}

export function getUnreadCount(): number | null {
  return unreadCount;
}

/** The server's latest total (any answer that carries one - a read, read-all, a page). */
export function setUnreadCount(count: number): void {
  // A newer server answer supersedes any refresh still in flight.
  refreshGeneration++;
  const next = Math.max(0, Math.floor(count));
  if (next !== unreadCount) {
    unreadCount = next;
    emitUnread();
  }
}

/** An optimistic local change (a row marked read before the server answers). Never below zero. */
export function adjustUnreadCount(delta: number): void {
  if (unreadCount === null) {
    return;
  }
  unreadCount = Math.max(0, unreadCount + delta);
  emitUnread();
}

/** Signed out: nobody's count is shown. */
export function resetNotificationState(): void {
  refreshGeneration++;
  unreadCount = null;
  emitUnread();
}

/** Re-reads the total (one indexed count on the server, never the list). A newer write wins over an older answer. */
export async function refreshUnreadCount(request: AuthenticatedApiRequest): Promise<void> {
  const generation = ++refreshGeneration;
  try {
    const count = await getUnreadNotificationCount(request);
    if (generation === refreshGeneration) {
      unreadCount = Math.max(0, count);
      emitUnread();
    }
  } catch {
    // Best-effort: the bell keeps what it showed; the next refresh corrects it.
  }
}

function subscribeUnread(listener: Listener): () => void {
  unreadListeners.add(listener);
  return () => {
    unreadListeners.delete(listener);
  };
}

/** The bell's unread total; null until first known. */
export function useUnreadNotificationCount(): number | null {
  return useSyncExternalStore(subscribeUnread, getUnreadCount, getUnreadCount);
}

type CollectionNewLinksReadListener = (collectionId: number) => void;
const newLinksReadListeners = new Set<CollectionNewLinksReadListener>();

/** A Collection was opened and its unread 새 링크 notifications were read on the server. */
export function emitCollectionNewLinksRead(collectionId: number): void {
  for (const listener of [...newLinksReadListeners]) {
    listener(collectionId);
  }
}

export function subscribeCollectionNewLinksRead(listener: CollectionNewLinksReadListener): () => void {
  newLinksReadListeners.add(listener);
  return () => {
    newLinksReadListeners.delete(listener);
  };
}
