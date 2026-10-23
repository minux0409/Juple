import { createContext, useContext, useSyncExternalStore } from 'react';
import { attentionCounts } from './attentionState';
import type { MobileAttentionStore } from './mobileAttention';

export const AttentionContext = createContext<MobileAttentionStore | null>(null);
const empty = { invitations: null, friends: null, collections: null, counts: attentionCounts([], [], []) };
const noopSubscribe = () => () => {};
const getEmpty = () => empty;
export function useMobileAttention() { return useContext(AttentionContext); }
export function useAttentionSnapshot() {
  const store = useMobileAttention();
  return useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? getEmpty, store?.getSnapshot ?? getEmpty);
}
