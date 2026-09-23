import { useEffect, useRef } from 'react';
import { isDetailedShareDiagnosticsEnabled } from '../api/apiConfig';
import { navigationRef } from '../navigation/navigationRef';
import { getActiveNewLinkReviewDraft } from './activeNewLinkReviewDraft';
import { normalizeShareTextForComparison, resolveIncomingShare } from './resolveIncomingShare';
import { useIncomingShare } from './useIncomingShare';

/**
 * Headless (renders nothing - same convention as App.tsx's PushRegistrationSync/
 * CategorySnapshotSync) top-level router for any share PendingShareQueue still holds once the app's
 * full navigation stack is up: Quick Save OFF always lands here (ShareReceiverActivity opens
 * MainActivity directly - see its own comment), and Quick Save ON's composer can leave a share
 * pending too if its background save needed review/failed. Either way this always navigates
 * explicitly to NewLinkReview - never a "whatever tab happens to be focused" prefill - so the
 * outcome is independent of the app's last navigation state (see RootStack.tsx).
 *
 * Exception: a NewLinkReview draft can already be open (see activeNewLinkReviewDraft.ts) when a
 * new share arrives - React Navigation's `navigate()` to an already-focused same-name route only
 * merges params rather than remounting it, so navigating straight there the way this router always
 * used to would silently strand the new share behind the untouched old draft. When a draft is
 * active this router hands the share off to it instead (see below) - NewLinkReviewScreen owns the
 * conflict dialog/save-or-discard decision from there, never this router.
 */
export function IncomingShareRouter(): null {
  const { pendingShare, acknowledgePendingShare } = useIncomingShare();
  // Tracks the last pendingShare id this router has already acted on, so a re-render/poll that
  // still reports the same share (e.g. an unrelated AppState change) never navigates twice - only
  // an actual new id (a different share) triggers another navigate. Also covers the hand-off case:
  // once a share has been handed to an active draft's conflict dialog, it must not be handed off
  // (or re-navigated to) again on every subsequent poll while that dialog is still up.
  const lastHandledShareIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingShare || pendingShare.id === lastHandledShareIdRef.current) {
      return;
    }
    if (!navigationRef.isReady()) {
      return;
    }

    // The same shared resolver Quick Save ON's headless save uses (see resolveIncomingShare/
    // incomingShareHeadlessTask) - ON and OFF must never resolve a share's URL/title differently.
    const resolvedShare = resolveIncomingShare(pendingShare);

    const activeDraft = getActiveNewLinkReviewDraft();
    if (activeDraft) {
      lastHandledShareIdRef.current = pendingShare.id;

      if (activeDraft.getNormalizedUrl() === normalizeShareTextForComparison(resolvedShare.text)) {
        // Same link the open draft is already reviewing - a harmless duplicate share, not a real
        // conflict. Consumed silently so it doesn't linger in the native queue and re-trigger this
        // same check forever; never shown as a dialog, never pushes a second Review.
        acknowledgePendingShare(pendingShare.id).catch(() => undefined);
        return;
      }

      // Handed off entirely - the draft's own conflict dialog/save-or-discard flow now owns this
      // share, including its eventual acknowledgePendingShare call. Never navigate/acknowledge it
      // here.
      activeDraft.onConflictingShare(pendingShare);
      return;
    }

    lastHandledShareIdRef.current = pendingShare.id;

    // Dev/Dogfood only - booleans/enums only, never the shared text, URL, or resolved title text.
    if (isDetailedShareDiagnosticsEnabled) {
      console.log('[IncomingShareRouter] navigate to NewLinkReview', {
        parsedKind: resolvedShare.kind,
        resolvedTitlePresent: resolvedShare.title !== null,
        titleSource: resolvedShare.titleSource,
      });
    }

    navigationRef.navigate('NewLinkReview', {
      url: resolvedShare.text,
      initialTitle: resolvedShare.title,
      preselectedCollectionId: pendingShare.draftCollectionId ?? pendingShare.preselectedCollectionId,
    });

    // Removed from the native queue immediately, not only after the review screen's own Save -
    // otherwise backing out of that screen without saving would leave this same share pending
    // forever, re-triggering this same navigation on every later AppState change/app restart. From
    // here on the review screen's own local draft state is the only copy of this share that matters.
    acknowledgePendingShare(pendingShare.id).catch(() => undefined);
  }, [pendingShare, acknowledgePendingShare]);

  return null;
}
