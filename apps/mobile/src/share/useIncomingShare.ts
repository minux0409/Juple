import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { PendingShare } from './specs/NativeIncomingShare';
import { pendingShareSource } from './pendingShareSource';
import { AUTO_SAVE_SETTLE_MS, isAutoSaveInFlight, onAutoSaveSettled } from './autoSaveInFlight';

export interface UseIncomingShareResult {
  /** The oldest share waiting for review - never one whose Quick Save background save is still running. */
  readonly pendingShare: PendingShare | null;
  readonly acknowledgePendingShare: (id: string) => Promise<void>;
}

export function useIncomingShare(): UseIncomingShareResult {
  const [pendingShares, setPendingShares] = useState<readonly PendingShare[]>(
    [],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);

  const refreshPendingShares = useCallback(async () => {
    if (!pendingShareSource) {
      return;
    }

    const generation = ++refreshGeneration.current;
    const shares = await pendingShareSource.getPendingShares();
    if (!mounted.current || generation !== refreshGeneration.current) return;
    setNowMs(Date.now());
    setPendingShares(shares);
  }, []);

  const acknowledgePendingShare = useCallback(
    async (id: string) => {
      if (!pendingShareSource) {
        return;
      }

      await pendingShareSource.acknowledgePendingShare(id);
      await refreshPendingShares();
    },
    [refreshPendingShares],
  );

  useEffect(() => {
    mounted.current = true;
    refreshPendingShares().catch(() => undefined);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshPendingShares().catch(() => undefined);
      }
    });
    // A background save that just ended: saved (the share is gone) or not (now shown for review).
    const unsubscribe = onAutoSaveSettled(() => {
      refreshPendingShares().catch(() => undefined);
    });

    return () => {
      mounted.current = false;
      subscription.remove();
      unsubscribe();
    };
  }, [refreshPendingShares]);

  // A share held back while its background save runs is looked at again once that window ends,
  // even if no settle signal arrives (e.g. the save ran in another process that died).
  const inFlightShares = pendingShares.filter(share => isAutoSaveInFlight(share, nowMs));
  const nextSettleAtMs = inFlightShares.length > 0
    ? Math.min(...inFlightShares.map(share => share.receivedAtEpochMs + AUTO_SAVE_SETTLE_MS))
    : null;
  useEffect(() => {
    if (nextSettleAtMs === null) {
      return;
    }
    const timer = setTimeout(() => {
      refreshPendingShares().catch(() => undefined);
    }, Math.max(0, nextSettleAtMs - Date.now()) + 250);
    return () => clearTimeout(timer);
  }, [nextSettleAtMs, refreshPendingShares]);

  return {
    pendingShare: pendingShares.find(share => !isAutoSaveInFlight(share, nowMs)) ?? null,
    acknowledgePendingShare,
  };
}
