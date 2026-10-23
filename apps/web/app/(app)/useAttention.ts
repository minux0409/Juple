'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { AppApi } from '../../lib/appApi';
import { createAttentionStore, loadAttentionCollections } from '../../lib/attentionState';
import { receivedInvitations, type ReceivedCollectionInvitation } from '../../lib/collectionInvitations';
import type { CollectionSummary, CollectionsPage } from '../../lib/collectionsView';
import type { FriendRequest } from '../../lib/settings';
import { useSignedInApp } from './AppRoot';

function createStore(api: AppApi) {
  return createAttentionStore<ReceivedCollectionInvitation, FriendRequest, CollectionSummary>({
    invitations: () => receivedInvitations(api),
    friends: () => api<{ items: readonly FriendRequest[] }>({ path: '/api/v1/friends/requests' }).then(page => page.items),
    collections: active => loadAttentionCollections(path => api<CollectionsPage>({ path }), active),
  });
}
const stores = new WeakMap<AppApi, Map<string | object, ReturnType<typeof createStore>>>();

/** Account-keyed, in-memory only. The shell and pages share the same pending requests and DTOs. */
export function useAttention() {
  const { api, account } = useSignedInApp();
  const key = account.homeAccountId || account.localAccountId || account;
  const store = useMemo(() => {
    let accounts = stores.get(api);
    if (!accounts) { accounts = new Map(); stores.set(api, accounts); }
    let value = accounts.get(key);
    if (!value) { value = createStore(api); accounts.set(key, value); }
    return value;
  }, [api, key]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, snapshot };
}
