import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NativeIncomingShare, {
  type PendingShare,
} from './specs/NativeIncomingShare';
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

  const refreshPendingShares = useCallback(async () => {
    if (!NativeIncomingShare) {
      return;
    }

    const shares = await NativeIncomingShare.getPendingShares();
    setNowMs(Date.now());
    setPendingShares(shares);
  }, []);

  const acknowledgePendingShare = useCallback(
    async (id: string) => {
      if (!NativeIncomingShare) {
        return;
      }

      await NativeIncomingShare.acknowledgePendingShare(id);
      await refreshPendingShares();
    },
    [refreshPendingShares],
  );

  useEffect(() => {
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
