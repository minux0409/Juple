import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import type { Collection } from '../collections/api/collectionsApi';
import type { ReceivedCollectionInvitation } from '../collections/api/collaborationApi';
import type { FriendRequest } from '../friends/api/friendsApi';
import { createAttentionStore, loadAttentionCollections } from './attentionState';

export function createMobileAttentionStore(request: AuthenticatedApiRequest) {
  async function items<T>(path: string): Promise<readonly T[]> {
    const response = await request<{ items: readonly T[] }>({ method: 'GET', path });
    if (!response.body) throw new Error('Missing attention response');
    return response.body.items;
  }
  return createAttentionStore<ReceivedCollectionInvitation, FriendRequest, Collection>({
    invitations: () => items<ReceivedCollectionInvitation>('/api/v1/users/me/collection-invitations'),
    friends: () => items<FriendRequest>('/api/v1/friends/requests'),
    collections: active => loadAttentionCollections<Collection>(async path => {
      const response = await request<{ items: readonly Collection[]; nextCursor: string | null }>({ method: 'GET', path });
      if (!response.body) throw new Error('Missing collection attention response');
      return response.body;
    }, active),
  });
}
export type MobileAttentionStore = ReturnType<typeof createMobileAttentionStore>;
let activeStore: MobileAttentionStore | null = null;
let activeRequest: AuthenticatedApiRequest | null = null;

/** The mounted account provider binds before child passive effects; mocks/outside the app keep their original API path. */
export function bindMobileAttention(store: MobileAttentionStore, request: AuthenticatedApiRequest): () => void {
  activeStore = store;
  activeRequest = request;
  return () => { if (activeStore === store) { activeStore = null; activeRequest = null; } store.reset(); };
}
export function mobileAttentionFor(request: AuthenticatedApiRequest): MobileAttentionStore | null {
  return request === activeRequest ? activeStore : null;
}
export function currentMobileAttention(): MobileAttentionStore | null { return activeStore; }
