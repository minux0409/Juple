import { useEffect } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { syncCategorySnapshotToNative } from './categorySnapshotSync';

/**
 * Bootstraps the native category snapshot (see categorySnapshotSync.ts) once per sign-in, so
 * Direct Share shortcuts and the Quick Save composer's category picker reflect this account's
 * Collections even before the user ever opens the Categories tab. CollectionsScreen/
 * CollectionDetailsScreen re-sync on their own after any mutation - this only covers the initial
 * "just signed in, tab never opened yet" gap.
 */
export function useCategorySnapshotBootstrapSync(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';

  useEffect(() => {
    if (!isReady) {
      return;
    }
    syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
  }, [isReady, authenticatedRequest]);
}
