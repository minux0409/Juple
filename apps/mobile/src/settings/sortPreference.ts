import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type LinkSortOption = 'newest' | 'oldest' | 'title';
export type SortPreferenceKey = 'collectionDetailsLinkSort';

const storageKey = (key: SortPreferenceKey) => `juple.${key}`;

/**
 * Persists a screen's chosen link sort order, the same per-key AsyncStorage-backed pattern
 * viewModePreference.ts already uses for List/Grid (a small dedicated hook per concern, not one
 * shared global preferences store) - so a view-mode switch and a sort choice are independent,
 * separately-persisted screen preferences, exactly like the product wants ("View mode를 바꿔도
 * 현재 sort 유지"). Currently only CollectionDetailsScreen uses this - Home/History have no sort
 * control this round.
 */
export function useSortPreference(key: SortPreferenceKey, defaultValue: LinkSortOption = 'newest') {
  const [sortOption, setSortOptionState] = useState<LinkSortOption>(defaultValue);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && (value === 'newest' || value === 'oldest' || value === 'title')) {
        setSortOptionState(value);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);

  const setSortOption = (next: LinkSortOption) => {
    setSortOptionState(next);
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { sortOption, setSortOption } as const;
}
