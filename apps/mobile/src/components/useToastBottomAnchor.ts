import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { useAppToast } from './AppToast';

let nextAnchorOwnerId = 1;

/**
 * Registers this screen's current bottom anchor (the distance from the screen's own bottom edge
 * to the top of whatever app UI already occupies that space - a bottom tab bar, a fixed bottom
 * action bar, or just the safe-area inset) with the global AppToast Host while, and only while,
 * this screen is focused - see useAppToast's setToastBottomOffset/clearToastBottomOffset remarks
 * on why a bare "focus: set, blur: clear" pair needs the owner id this hook manages internally.
 *
 * Re-registers whenever `bottomOffset` itself changes (e.g. ItemDetails' measured action-bar
 * height settling after its first layout pass) without needing this screen to blur/refocus - this
 * only ever writes AppToast's own bottomOffset state, never its toast/timer state, so it can never
 * reset an in-flight Toast's auto-dismiss timer.
 */
export function useToastBottomAnchor(bottomOffset: number): void {
  const { setToastBottomOffset, clearToastBottomOffset } = useAppToast();
  const ownerIdRef = useRef<number | null>(null);
  if (ownerIdRef.current === null) {
    ownerIdRef.current = nextAnchorOwnerId++;
  }
  const ownerId = ownerIdRef.current;

  useFocusEffect(
    useCallback(() => {
      setToastBottomOffset(ownerId, bottomOffset);
      return () => clearToastBottomOffset(ownerId);
    }, [ownerId, bottomOffset, setToastBottomOffset, clearToastBottomOffset]),
  );
}
