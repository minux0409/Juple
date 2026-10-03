import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * ActionMenuDialog's chosen action that opens another dialog (a confirmation): on Android it simply
 * runs after the menu closes; iOS cannot present a Modal while another is still dismissing, so there it
 * waits for the menu's onDismiss. Wire `onMenuDismiss` to ActionMenuDialog's onDismiss and call
 * `afterMenuCloses(closeMenu, action)` from each menu action.
 */
export function useActionAfterMenu() {
  const pendingRef = useRef<(() => void) | null>(null);

  const afterMenuCloses = useCallback((closeMenu: () => void, action: () => void) => {
    closeMenu();
    if (Platform.OS === 'ios') {
      pendingRef.current = action;
    } else {
      action();
    }
  }, []);

  const onMenuDismiss = useCallback(() => {
    const next = pendingRef.current;
    pendingRef.current = null;
    next?.();
  }, []);

  return { afterMenuCloses, onMenuDismiss } as const;
}
