import type { PendingShare } from './specs/NativeIncomingShare';

/**
 * A single module-scope slot - the same imperative-registry pattern navigationRef.ts already uses
 * - that lets IncomingShareRouter (a plain sibling of the Stack.Navigator, not a descendant; see
 * RootStack.tsx) know whether the currently mounted screen is an unsaved NewLinkReview draft,
 * without threading React context through the navigator. Only one NewLinkReviewScreen instance is
 * ever mounted at a time (RootStack.tsx registers it as a single Stack.Screen, never pushed on top
 * of itself), so one slot - not a list/queue - is enough.
 *
 * Exists specifically so an incoming share that arrives while a NewLinkReview draft is open never
 * gets silently swallowed: React Navigation's `navigate()` to an already-focused screen of the
 * same name merges params into the existing route rather than remounting it, so the old
 * IncomingShareRouter behavior (navigate + immediately acknowledge) left the open draft's own
 * local state completely unchanged while the new share vanished from the native queue - the exact
 * bug this file exists to fix. See NewLinkReviewScreen's own registration/handling and
 * IncomingShareRouter's own conflict check.
 */
export interface ActiveNewLinkReviewDraft {
  /** Reads the draft's *current* URL (already comparison-normalized) at the moment it's called -
   * not a snapshot captured at registration time, since the user can still edit the URL field
   * while this draft is open. */
  readonly getNormalizedUrl: () => string;
  /** Called by IncomingShareRouter instead of its own navigate+acknowledge when a
   * different-URL share arrives while this draft is active - NewLinkReviewScreen owns everything
   * from here (conflict dialog, save-then-continue/discard-then-continue); IncomingShareRouter
   * must not acknowledge or navigate for this share itself once it hands it off. */
  readonly onConflictingShare: (share: PendingShare) => void;
}

let activeDraft: ActiveNewLinkReviewDraft | null = null;

export function registerActiveNewLinkReviewDraft(draft: ActiveNewLinkReviewDraft): void {
  activeDraft = draft;
}

/** Only clears the slot if it still holds this exact registration - guards against a stale
 * unmount's cleanup clearing a newer screen instance's registration (e.g. during a fast
 * replace-driven remount where the new instance's effect can run before the old one's cleanup). */
export function clearActiveNewLinkReviewDraft(draft: ActiveNewLinkReviewDraft): void {
  if (activeDraft === draft) {
    activeDraft = null;
  }
}

export function getActiveNewLinkReviewDraft(): ActiveNewLinkReviewDraft | null {
  return activeDraft;
}
