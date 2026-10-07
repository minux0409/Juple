import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/**
 * How a browsing screen lays the SAME loaded links out: under date headers ('grouped'), or as one
 * continuous run with no headers ('continuous'). Independent of List/Grid (see viewModePreference)
 * and of the data - it never changes what is fetched or the order.
 */
export type BrowsingGroupingMode = 'grouped' | 'continuous';
export type GroupingModePreferenceKey = 'historyGroupingMode';

const storageKey = (key: GroupingModePreferenceKey) => `juple.${key}`;

export function useGroupingModePreference(key: GroupingModePreferenceKey, defaultValue: BrowsingGroupingMode = 'grouped') {
  const [groupingMode, setGroupingMode] = useState<BrowsingGroupingMode>(defaultValue);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && (value === 'grouped' || value === 'continuous')) {
        setGroupingMode(value);
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key]);

  const changeGroupingMode = (next: BrowsingGroupingMode) => {
    setGroupingMode(next);
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { groupingMode, changeGroupingMode } as const;
}
