/**
 * The bell's unread total, shared by the bell, its panel, the 알림 page and an opened Collection (the mobile notificationState.ts).
 * Module level, so every writer (a read, 모두 읽음, a page that carries the count) updates the one bell. Never persisted - the server's
 * count is the truth; this only mirrors it. A newer server answer always wins over an older refresh still in flight.
 */
type Listener = () => void;

let unreadCount: number | null = null;
let generation = 0;
let lastRefreshAtMs = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getUnreadCount(): number | null {
  return unreadCount;
}

export function subscribeUnreadCount(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server's latest total (any answer that carries one: a read, 모두 읽음, a page). */
export function setUnreadCount(count: number): void {
  generation++;
  const next = Math.max(0, Math.floor(count));
  if (next !== unreadCount) {
    unreadCount = next;
    emit();
  }
}

/** An optimistic local change (a row read before the server answers). Never below zero; nothing before the first count. */
export function adjustUnreadCount(delta: number): void {
  if (unreadCount === null) {
    return;
  }
  generation++;
  unreadCount = Math.max(0, unreadCount + delta);
  emit();
}

/** Signed out: nobody's count is shown. */
export function resetUnreadCount(): void {
  generation++;
  unreadCount = null;
  lastRefreshAtMs = 0;
  emit();
}

/** Re-reads the total (one indexed count on the server, never the list). A failure keeps what is shown. */
export async function refreshUnreadCount(fetchCount: () => Promise<number>, nowMs: number = Date.now()): Promise<void> {
  const mine = ++generation;
  lastRefreshAtMs = nowMs;
  try {
    const count = await fetchCount();
    if (mine === generation) {
      unreadCount = Math.max(0, Math.floor(count));
      emit();
    }
  } catch {
    // Best effort: the bell keeps what it showed; the next refresh corrects it.
  }
}

/**
 * The Web has no live channel (no Push to the browser): the bell is re-read when the app starts, when the window comes back
 * (focus / visible) and after moving to another page - but at most once per this interval for the automatic ones, so nothing polls.
 */
export const UNREAD_REFRESH_MIN_INTERVAL_MS = 15_000;

export function shouldAutoRefresh(nowMs: number = Date.now()): boolean {
  return unreadCount === null || nowMs - lastRefreshAtMs >= UNREAD_REFRESH_MIN_INTERVAL_MS;
}
