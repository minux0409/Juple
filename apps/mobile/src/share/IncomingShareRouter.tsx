import { useEffect, useRef } from 'react';
import { isDetailedShareDiagnosticsEnabled } from '../api/apiConfig';
import { navigationRef } from '../navigation/navigationRef';
import { resolveIncomingShare } from './resolveIncomingShare';
import { useIncomingShare } from './useIncomingShare';

/**
 * Headless (renders nothing - same convention as App.tsx's PushRegistrationSync/
 * CategorySnapshotSync) top-level router for any share PendingShareQueue still holds once the app's
 * full navigation stack is up: Quick Save OFF always lands here (ShareReceiverActivity opens
 * MainActivity directly - see its own comment), and Quick Save ON's composer can leave a share
 * pending too if its background save needed review/failed. Either way this always navigates
 * explicitly to NewLinkReview - never a "whatever tab happens to be focused" prefill - so the
 * outcome is independent of the app's last navigation state (see RootStack.tsx).
 */
export function IncomingShareRouter(): null {
  const { pendingShare, acknowledgePendingShare } = useIncomingShare();
  // Tracks the last pendingShare id this router has already acted on, so a re-render/poll that
  // still reports the same share (e.g. an unrelated AppState change) never navigates twice - only
  // an actual new id (a different share) triggers another navigate.
  const lastHandledShareIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingShare || pendingShare.id === lastHandledShareIdRef.current) {
      return;
    }
    if (!navigationRef.isReady()) {
      return;
    }

    lastHandledShareIdRef.current = pendingShare.id;

    // The same shared resolver Quick Save ON's headless save uses (see resolveIncomingShare/
    // incomingShareHeadlessTask) - ON and OFF must never resolve a share's URL/title differently.
    const resolvedShare = resolveIncomingShare(pendingShare);
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
