import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

/** 시간순 ↓ newest / ↑ oldest, 이름순 ↑ title (A→Z) / ↓ titleDesc (Z→A). */
export type LinkSortOption = 'newest' | 'oldest' | 'title' | 'titleDesc';

/** Whether this is one of the two 이름순 directions. */
export const isNameSort = (sort: LinkSortOption): sort is 'title' | 'titleDesc' => sort === 'title' || sort === 'titleDesc';

/** Pressing 시간순: first press picks newest ↓; pressed again it flips ↓ newest ↔ ↑ oldest. */
export const nextDateSort = (current: LinkSortOption): LinkSortOption => (current === 'newest' ? 'oldest' : 'newest');

/** Pressing 이름순: first press picks A→Z ↑; pressed again it flips ↑ ↔ ↓. */
export const nextNameSort = (current: LinkSortOption): LinkSortOption => (current === 'title' ? 'titleDesc' : 'title');
export type SortPreferenceKey = 'collectionDetailsLinkSort' | 'replicatePickerSort' | 'homeLinkSort' | 'trashLinkSort' | 'historyLinkSort';

const storageKey = (key: SortPreferenceKey) => `juple.${key}`;

/**
 * Persists a screen's chosen link sort order, the same per-key AsyncStorage-backed pattern
 * viewModePreference.ts already uses for List/Grid (a small dedicated hook per concern, not one
 * shared global preferences store) - so a view-mode switch and a sort choice are independent,
 * separately-persisted screen preferences, exactly like the product wants ("View mode를 바꿔도
 * 현재 sort 유지"). CollectionDetailsScreen's link sort, and the 다른 컬렉션에 복제 picker's own
 * Collection order ('newest' / 'title' only) under its own key.
 */
export function useSortPreference(key: SortPreferenceKey, defaultValue: LinkSortOption = 'newest') {
  const [sortOption, setSortOptionState] = useState<LinkSortOption>(defaultValue);
  // The stored value is read asynchronously: until `isReady`, `sortOption` is only the default. A screen whose FIRST request
  // depends on the order (the Archive) waits for it, so it never fetches in an order the user is not using. A failed read
  // still makes it ready - with the default - so a storage problem can never hold a screen back.
  const [isReady, setIsReady] = useState(false);
  const chosenByUser = useRef(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && !chosenByUser.current && (value === 'newest' || value === 'oldest' || value === 'title' || value === 'titleDesc')) {
        setSortOptionState(value);
      }
    }).catch(() => undefined).finally(() => {
      if (active) {
        setIsReady(true);
      }
    });
    return () => { active = false; };
  }, [key]);

  const setSortOption = (next: LinkSortOption) => {
    chosenByUser.current = true;
    setSortOptionState(next);
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { sortOption, setSortOption, isReady } as const;
}
