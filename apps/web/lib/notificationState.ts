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
export async function refreshUnreadCount(fetchCount: () => Promise<number>, nowMs: number = Date.now()): Promise<boolean> {
  const mine = ++generation;
  lastRefreshAtMs = nowMs;
  try {
    const count = await fetchCount();
    if (mine === generation) {
      unreadCount = Math.max(0, Math.floor(count));
      emit();
    }
    lastRetryAfterSeconds = 0;
    return true;
  } catch (error) {
    // Best effort: the bell keeps what it showed; the next refresh corrects it. A 429's Retry-After is kept for the poll's next wait.
    const retry = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
    lastRetryAfterSeconds = typeof retry === 'number' && Number.isFinite(retry) && retry > 0 ? retry : 0;
    return false;
  }
}

let lastRetryAfterSeconds = 0;
/** The Retry-After (seconds) the API sent with the last failed count read, or 0 - the poll never asks again sooner than this. */
export function lastUnreadRetryAfterSeconds(): number {
  return lastRetryAfterSeconds;
}

/** While the app is open and visible, the bell total is re-read this often - the one signal that also moves the 친구 / 컬렉션 badges. */
export const UNREAD_POLL_INTERVAL_MS = 60_000;
export const UNREAD_POLL_MAX_INTERVAL_MS = 300_000;

/** The wait before the next poll: the base interval, doubling per consecutive failure (a 429 or an outage), capped. Never below the base. */
export function nextUnreadPollDelayMs(consecutiveFailures: number): number {
  const failures = Math.max(0, Math.floor(consecutiveFailures));
  return Math.min(UNREAD_POLL_MAX_INTERVAL_MS, UNREAD_POLL_INTERVAL_MS * 2 ** Math.min(failures, 8));
}

/**
 * The Web has no live channel (no Push to the browser): the bell is re-read when the app starts, when the window comes back
 * (focus / visible) and after moving to another page - but at most once per this interval for the automatic ones. On top of that
 * the signed-in shell runs ONE slow visible-tab poll (UNREAD_POLL_INTERVAL_MS, backing off on failures) so a new friend request
 * or invitation reaches the menu badges without a reload.
 */
export const UNREAD_REFRESH_MIN_INTERVAL_MS = 15_000;

export function shouldAutoRefresh(nowMs: number = Date.now()): boolean {
  return unreadCount === null || nowMs - lastRefreshAtMs >= UNREAD_REFRESH_MIN_INTERVAL_MS;
}
