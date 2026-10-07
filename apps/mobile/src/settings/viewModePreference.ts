import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export type ViewMode = 'list' | 'grid';
/** Saved-link browsing adds a third, image-only presentation (see SavedLinkImageTile) - only on the screens listed below. */
export type SavedLinkViewMode = ViewMode | 'image';
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

/** Home and the Archive: the only surfaces whose stored preference may be 'image' (everywhere else it is unknown and falls back). */
type ImageViewModePreferenceKey = 'homeViewMode' | 'historyViewMode';
const IMAGE_CAPABLE_KEYS: ReadonlySet<ViewModePreferenceKey> = new Set<ViewModePreferenceKey>(['homeViewMode', 'historyViewMode']);

const storageKey = (key: ViewModePreferenceKey) => `juple.${key}`;

/**
 * Screens that show the same thing in different places (Share status and the participants popup both
 * show the participants) must agree at once, even while both are mounted in the navigation stack -
 * so a change is also announced in memory to every other hook instance using the same key.
 */
const changeListeners = new Map<ViewModePreferenceKey, Set<(mode: SavedLinkViewMode) => void>>();

export function useViewModePreference(key: ImageViewModePreferenceKey, defaultValue?: SavedLinkViewMode): { readonly viewMode: SavedLinkViewMode; readonly changeViewMode: (next: SavedLinkViewMode) => void };
export function useViewModePreference(key: ViewModePreferenceKey, defaultValue?: ViewMode): { readonly viewMode: ViewMode; readonly changeViewMode: (next: ViewMode) => void };
export function useViewModePreference(key: ViewModePreferenceKey, defaultValue: SavedLinkViewMode = 'list'): { readonly viewMode: SavedLinkViewMode; readonly changeViewMode: (next: never) => void } {
  const [viewMode, setViewMode] = useState<SavedLinkViewMode>(defaultValue);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey(key)).then(value => {
      if (active && (value === 'list' || value === 'grid' || (value === 'image' && IMAGE_CAPABLE_KEYS.has(key)))) {
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

  const changeViewMode = (next: SavedLinkViewMode) => {
    setViewMode(next);
    changeListeners.get(key)?.forEach(listener => listener(next));
    void AsyncStorage.setItem(storageKey(key), next).catch(() => undefined);
  };

  return { viewMode, changeViewMode } as const;
}
