import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type ViewMode = 'list' | 'grid';
export type ViewModePreferenceKey =
  | 'homeViewMode'
  | 'historyViewMode'
  | 'categoryViewMode'
  | 'categoryPickerViewMode'
  | 'collectionDetailsViewMode';

const storageKey = (key: ViewModePreferenceKey) => `juple.${key}`;

export function useViewModePreference(key: ViewModePreferenceKey, defaultValue: ViewMode = 'list') {
  const [viewMode, setViewMode] = useState<ViewMode>(defaultValue);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && (value === 'list' || value === 'grid')) {
        setViewMode(value);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);

  const changeViewMode = (next: ViewMode) => {
    setViewMode(next);
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { viewMode, changeViewMode } as const;
}
