import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { getHostnameFromUrl } from '../../items/savedLinkPrimaryText';
import { NO_COLLECTION_ID, type QuickSaveOutcome } from '../quickSaveDraft';
import { extractTitleCandidateFromSharedText, parseSharedText } from '../sharedTextParser';
import NativeIncomingShare, { type CategorySnapshotEntry } from '../specs/NativeIncomingShare';

const POLL_INTERVAL_MS = 400;
const MAX_WAIT_MS = 15_000;
const AUTO_CLOSE_DELAY_MS = 700;

export type ComposerPhase =
  | 'loading'
  | 'ready'
  | 'saving'
  | 'success'
  /** Save was confirmed and durably scheduled, but no terminal outcome arrived within MAX_WAIT_MS - the existing native retry infrastructure keeps working in the background regardless of this screen closing. */
  | 'queued'
  | 'reviewRequired'
  | 'authenticationRequired'
  | 'retryableFailure'
  | 'permanentFailure';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * All state/logic behind the Quick Save composer - deliberately has no dependency on AuthProvider
 * or React Navigation. The category list comes from the native snapshot (instant, no network),
 * and Save only ever writes a draft + polls a native outcome store; the actual authenticated
 * network calls happen entirely inside the existing headless save task (see
 * incomingShareHeadlessTask.ts), never here.
 */
export function useQuickSaveComposer(pendingShareId: string | null) {
  const [phase, setPhase] = useState<ComposerPhase>('loading');
  const [displayText, setDisplayText] = useState('');
  const [title, setTitle] = useState('');
  const [categories, setCategories] = useState<ReadonlyArray<CategorySnapshotEntry>>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);

  const isMountedRef = useRef(true);
  const pollGenerationRef = useRef(0);
  // React state (`phase`) only updates on the next render, so two onPress calls in the same tick
  // (e.g. a rapid double-tap, or a test calling the prop function twice synchronously) would both
  // still see phase === 'ready' - this ref is checked/set synchronously instead, the same guard
  // pattern used elsewhere in this codebase (e.g. ItemDetailsScreen's isSavingRef) for exactly
  // this "Save must fire at most once" guarantee.
  const isSavingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const close = useCallback(() => {
    NativeIncomingShare?.finishComposerActivity();
  }, []);

  useEffect(() => {
    const nativeModule = NativeIncomingShare;
    if (!pendingShareId || !nativeModule) {
      setPhase('permanentFailure');
      return;
    }

    (async () => {
      const [pendingShares, categorySnapshot] = await Promise.all([
        nativeModule.getPendingShares(),
        nativeModule.getCategorySnapshot(),
      ]);
      if (!isMountedRef.current) {
        return;
      }

      const pendingShare = pendingShares.find(share => share.id === pendingShareId);
      if (!pendingShare) {
        setPhase('permanentFailure');
        return;
      }

      const parsedShare = parseSharedText(pendingShare.text);
      const domainCandidate =
        parsedShare.kind === 'exactUrl' ? getHostnameFromUrl(parsedShare.text) : null;
      setDisplayText(domainCandidate ?? pendingShare.text);

      const fallbackTitleCandidate =
        parsedShare.kind === 'reviewText'
          ? extractTitleCandidateFromSharedText(pendingShare.text)?.titleCandidate
          : undefined;
      setTitle(pendingShare.initialTitle ?? fallbackTitleCandidate ?? '');

      setCategories(categorySnapshot);
      // A preselected category (from a Direct Share shortcut) can be stale by the time this
      // composer actually loads the snapshot (e.g. deleted moments earlier on another device) -
      // falls back to "no category selected" rather than pointing at an id the picker can't show.
      const isPreselectedCategoryStillValid = categorySnapshot.some(
        category => category.id === pendingShare.preselectedCollectionId,
      );
      setSelectedCollectionId(
        isPreselectedCategoryStillValid ? pendingShare.preselectedCollectionId : null,
      );
      setPhase('ready');
    })();
  }, [pendingShareId]);

  const pollOutcome = useCallback(
    async (generation: number) => {
      const nativeModule = NativeIncomingShare;
      if (!nativeModule || !pendingShareId) {
        return;
      }

      const startedAt = Date.now();
      while (isMountedRef.current && pollGenerationRef.current === generation) {
        const outcome: QuickSaveOutcome = await nativeModule.getQuickSaveOutcome(pendingShareId) as QuickSaveOutcome;

        if (outcome === 'success') {
          setPhase('success');
          return;
        }
        if (outcome !== 'pending') {
          setPhase(outcome);
          return;
        }
        if (Date.now() - startedAt >= MAX_WAIT_MS) {
          setPhase('queued');
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    },
    [pendingShareId],
  );

  const save = useCallback(() => {
    const nativeModule = NativeIncomingShare;
    if (!nativeModule || !pendingShareId || isSavingRef.current) {
      return;
    }
    if (phase !== 'ready' && phase !== 'retryableFailure') {
      return;
    }

    isSavingRef.current = true;
    setPhase('saving');
    const generation = ++pollGenerationRef.current;

    (async () => {
      try {
        await nativeModule.submitQuickSaveDraft(
          pendingShareId,
          title.trim(),
          selectedCollectionId ?? NO_COLLECTION_ID,
        );
        await pollOutcome(generation);
      } finally {
        isSavingRef.current = false;
      }
    })();
  }, [phase, pendingShareId, pollOutcome, selectedCollectionId, title]);

  const cancel = useCallback(() => {
    const nativeModule = NativeIncomingShare;
    if (!nativeModule || !pendingShareId) {
      return;
    }
    nativeModule.acknowledgePendingShare(pendingShareId).finally(() => {
      nativeModule.finishComposerActivity();
    });
  }, [pendingShareId]);

  // Android Back is Cancel before Save is tapped (discards the pending share, same as tapping
  // Cancel); once Save has fired, the durable background save is already in motion and no longer
  // cancellable, so Back just closes this screen without touching it.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (phase === 'ready') {
        cancel();
      } else {
        close();
      }
      return true;
    });
    return () => subscription.remove();
  }, [cancel, close, phase]);

  useEffect(() => {
    if (phase === 'success' || phase === 'queued') {
      const timer = setTimeout(close, AUTO_CLOSE_DELAY_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [close, phase]);

  return {
    phase,
    displayText,
    title,
    setTitle,
    categories,
    selectedCollectionId,
    setSelectedCollectionId,
    save,
    cancel,
    close,
  };
}
