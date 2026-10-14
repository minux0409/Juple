/**
 * The 되돌리기 snackbar of a reversible action (mobile AppToast / UndoToast): after the action succeeded and the page already shows the
 * result, "삭제했습니다 · 되돌리기" stays for UNDO_TOAST_DURATION_MS. Pure state, so the rules are unit-tested:
 *  - one toast at a time (a newer action replaces the older one - its undo is gone, the action itself stays);
 *  - 되돌리기 runs once (a second click while it is running does nothing);
 *  - success closes it, a failure says so and stays until closed (the action stays as it was);
 *  - waiting out the time closes it and leaves the action as it is.
 */

/** Mobile's UNDO_TOAST_DURATION_MS. */
export const UNDO_TOAST_DURATION_MS = 5000;
/** A plain notice (no action) is shorter than an offer to undo. */
export const NOTICE_TOAST_DURATION_MS = 4000;

export type ToastState =
  | null
  | { readonly id: number; readonly kind: 'notice'; readonly message: string; readonly tone: 'info' | 'error' }
  | {
      readonly id: number;
      readonly kind: 'undo';
      readonly message: string;
      readonly phase: 'offer' | 'undoing' | 'failed';
      /** What the failure says (mobile's undoErrorMessage). */
      readonly errorMessage: string;
    };

export function showNotice(id: number, message: string, tone: 'info' | 'error' = 'info'): ToastState {
  return { id, kind: 'notice', message, tone };
}

export function showUndo(id: number, message: string, errorMessage: string): ToastState {
  return { id, kind: 'undo', message, phase: 'offer', errorMessage };
}

/** 되돌리기 was pressed: only an offer that is not already running starts (the caller runs the undo exactly when `start` is true). */
export function beginUndo(state: ToastState, id: number): { readonly state: ToastState; readonly start: boolean } {
  if (state?.kind !== 'undo' || state.id !== id || state.phase !== 'offer') {
    return { state, start: false };
  }
  return { state: { ...state, phase: 'undoing' }, start: true };
}

/** The undo succeeded: the toast is done. Only the toast that started it is closed (a newer one stays). */
export function finishUndo(state: ToastState, id: number): ToastState {
  return state?.id === id ? null : state;
}

/** The undo failed: the failure is shown in its place and stays until closed. */
export function failUndo(state: ToastState, id: number): ToastState {
  return state?.kind === 'undo' && state.id === id ? { ...state, phase: 'failed' } : state;
}

/** The time ran out: an offer (or a notice) closes - an undo that is already running is never cut off, and a failure is kept for reading. */
export function expire(state: ToastState, id: number): ToastState {
  if (!state || state.id !== id) {
    return state;
  }
  if (state.kind === 'undo' && state.phase !== 'offer') {
    return state;
  }
  return null;
}

export function dismiss(state: ToastState, id: number): ToastState {
  return state?.id === id && !(state.kind === 'undo' && state.phase === 'undoing') ? null : state;
}

/** How long the toast stays before it closes by itself; null while nothing should time out (running / failed undo). */
export function timeoutOf(state: ToastState): number | null {
  if (!state) {
    return null;
  }
  if (state.kind === 'notice') {
    return state.tone === 'error' ? NOTICE_TOAST_DURATION_MS * 2 : NOTICE_TOAST_DURATION_MS;
  }
  return state.phase === 'offer' ? UNDO_TOAST_DURATION_MS : null;
}
