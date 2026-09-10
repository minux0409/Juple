import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NativeIncomingShare, {
  type PendingShare,
} from './specs/NativeIncomingShare';

export interface UseIncomingShareResult {
  readonly pendingShare: PendingShare | null;
  readonly acknowledgePendingShare: (id: string) => Promise<void>;
}

export function useIncomingShare(): UseIncomingShareResult {
  const [pendingShares, setPendingShares] = useState<readonly PendingShare[]>(
    [],
  );

  const refreshPendingShares = useCallback(async () => {
    if (!NativeIncomingShare) {
      return;
    }

    setPendingShares(await NativeIncomingShare.getPendingShares());
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

    return () => subscription.remove();
  }, [refreshPendingShares]);

  return {
    pendingShare: pendingShares[0] ?? null,
    acknowledgePendingShare,
  };
}
