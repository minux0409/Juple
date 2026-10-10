/**
 * Keeps at most one SwipeableItemRow open across a whole list (Home/History) - opening a row
 * closes whichever other row was open, and a list's onScrollBeginDrag can close the open row too.
 * Plain module state (not React context) so it works the same across Home's FlatList and
 * History's SectionList without either needing to own the other's row state.
 */

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
