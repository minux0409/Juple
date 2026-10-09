import { useEffect } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { reconcileCollectionShortcuts } from './collectionShortcutSync';

/**
 * Reconciles the Collections the user pinned as app shortcuts (see collectionShortcutSync.ts) once per sign-in, so a
 * Collection deleted, left or locked while the app was closed does not linger in the launcher / share sheet before the
 * user ever opens the Collections tab. With nothing pinned it makes no request. CollectionsScreen/CollectionDetailsScreen
 * keep it right on their own afterwards - this only covers the "just signed in, tab never opened yet" gap.
 */
export function useCollectionShortcutBootstrapSync(): void {
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();
  const isReady = isAuthenticated && userBootstrapStatus === 'ready';

  useEffect(() => {
    if (!isReady) {
      return;
    }
    reconcileCollectionShortcuts(authenticatedRequest).catch(() => undefined);
  }, [isReady, authenticatedRequest]);
}
