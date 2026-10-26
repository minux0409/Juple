/**
 * Keeps at most one SwipeableItemRow open across a whole list (Home/History) - opening a row
 * closes whichever other row was open, and a list's onScrollBeginDrag can close the open row too.
 * Plain module state (not React context) so it works the same across Home's FlatList and
 * History's SectionList without either needing to own the other's row state.
 */

import { useSyncExternalStore } from 'react';

type CloseFn = () => void;

let openRowClose: CloseFn | null = null;
const openListeners = new Set<() => void>();

/** Tells the caller whenever any row is swiped open (the swipe hint's "the gesture was performed"). Returns the unsubscribe. */
export function subscribeRowOpened(listener: () => void): () => void {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
}

/** Called by a row when it finishes opening - closes whichever other row was previously open. */
export function notifyRowOpened(close: CloseFn): void {
  if (openRowClose && openRowClose !== close) {
    openRowClose();
  }
  openRowClose = close;
  openListeners.forEach(listener => listener());
}

/** Called by a row once it's back at rest (closed), whether via gesture or closeOpenRow(). */
export function notifyRowClosed(close: CloseFn): void {
  if (openRowClose === close) {
    openRowClose = null;
  }
}

/** Closes whichever row is currently open, if any - e.g. on scroll start or another row's tap. */
export function closeOpenRow(): void {
  const close = openRowClose;
  openRowClose = null;
  close?.();
}

// --- Scroll lock while a row is being swiped ---------------------------------------------------------------------------------

let scrollLocked = false;
const scrollLockListeners = new Set<() => void>();

/**
 * Set by a row while its horizontal swipe is in progress (from the moment the gesture is recognized as horizontal until it is
 * released): the list under it stops scrolling, so a finger that drifts a little up or down does not turn the swipe into a scroll
 * that cancels the row. Cleared on release and on every termination, so the list can never stay frozen.
 */
export function setSwipeScrollLock(locked: boolean): void {
  if (scrollLocked === locked) {
    return;
  }
  scrollLocked = locked;
  scrollLockListeners.forEach(listener => listener());
}

function subscribeScrollLock(listener: () => void): () => void {
  scrollLockListeners.add(listener);
  return () => {
    scrollLockListeners.delete(listener);
  };
}

/** For a list that hosts swipe rows: `scrollEnabled={useSwipeAwareScrollEnabled()}`. */
export function useSwipeAwareScrollEnabled(): boolean {
  return useSyncExternalStore(subscribeScrollLock, () => !scrollLocked);
}
