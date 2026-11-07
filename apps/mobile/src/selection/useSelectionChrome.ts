import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useSelectionBar, type SelectionBarModel } from './SelectionBarContext';

/**
 * What every selecting screen shares: while selection is on,
 *  - the bottom action bar replaces the tab bar (and the tab bar returns when it ends),
 *  - Android's back button leaves selection mode first (nothing else happens on that press; iOS has the close button),
 *  - leaving the screen (another tab, a detail screen) ends the selection, so no stale selection is waiting on return.
 */
export function useSelectionChrome(isActive: boolean, onExit: () => void, bar: SelectionBarModel | null): void {
  useSelectionBar(isActive ? bar : null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useFocusEffect(
    useCallback(() => {
      if (!isActive) {
        return undefined;
      }
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        exitRef.current();
        return true;
      });
      return () => subscription.remove();
    }, [isActive]),
  );

  // Blur (tab change, a pushed screen) ends the selection. The callback is stable (empty deps), so this runs only on a real blur.
  useFocusEffect(
    useCallback(() => () => exitRef.current(), []),
  );
}
