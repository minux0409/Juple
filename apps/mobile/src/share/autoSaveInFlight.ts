import type { PendingShare } from './specs/NativeIncomingShare';

/**
 * How long a Quick Save ON share may be held back from review while its background save runs: the
 * immediate attempt's own budget (about 45s - see IncomingShareRetryScheduler) plus a margin. Past
 * this, a share that is somehow still pending with no reported outcome (the process died mid-save)
 * is shown for review exactly as before.
 */
export const AUTO_SAVE_SETTLE_MS = 60_000;

/**
 * A share captured with Quick Save ON whose background save has not ended yet: it is being saved
 * right now, so it must not also be opened in NewLinkReview (which would offer to save the same
 * link a second time). Once that save fails or needs review it reports an outcome, and the share
 * is shown for review like any other; once it succeeds, the share is gone from the queue.
 */
export function isAutoSaveInFlight(share: PendingShare, nowMs: number): boolean {
  return share.autoSave === true
    && (share.autoSaveOutcome ?? null) === null
    && nowMs - share.receivedAtEpochMs < AUTO_SAVE_SETTLE_MS;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Tells anything waiting on a background save that one just ended (saved or not) - see useIncomingShare. */
export function notifyAutoSaveSettled(): void {
  listeners.forEach(listener => listener());
}

export function onAutoSaveSettled(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
