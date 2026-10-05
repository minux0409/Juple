import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type ViewMode = 'list' | 'grid';
export type ViewModePreferenceKey =
  | 'homeViewMode'
  | 'historyViewMode'
  | 'categoryViewMode'
  | 'categoryPickerViewMode'
  | 'replicatePickerViewMode'
  | 'collectionDetailsViewMode'
  | 'friendsViewMode'
  | 'participantViewMode'
  | 'trashViewMode';

const storageKey = (key: ViewModePreferenceKey) => `juple.${key}`;

/**
 * Screens that show the same thing in different places (Share status and the participants popup both
 * show the participants) must agree at once, even while both are mounted in the navigation stack -
 * so a change is also announced in memory to every other hook instance using the same key.
 */
const changeListeners = new Map<ViewModePreferenceKey, Set<(mode: ViewMode) => void>>();

export function useViewModePreference(key: ViewModePreferenceKey, defaultValue: ViewMode = 'list') {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultValue);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && (value === 'list' || value === 'grid')) {
        setViewMode(value);
      } else if (value !== null && value !== undefined) {
        // A value this build does not know - the retired 'calendar' view mode of an earlier Round 36 build (the date
        // is a filter now): fall back to List, and rewrite it so it never comes back.
        void AsyncStorage.setItem(storageKey(key), 'list').catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    const listeners = changeListeners.get(key) ?? new Set();
    changeListeners.set(key, listeners);
    listeners.add(setViewMode);
    return () => { listeners.delete(setViewMode); };
  }, [key]);

  const changeViewMode = (next: ViewMode) => {
    setViewMode(next);
    changeListeners.get(key)?.forEach(listener => listener(next));
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { viewMode, changeViewMode } as const;
}
