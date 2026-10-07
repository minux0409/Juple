import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/** How long a visible toast takes to follow its anchor (e.g. down to the bottom when the keyboard closes). */
export const TOAST_ANCHOR_MOVE_MS = 220;

/**
 * A toast's `bottom`, animated: it starts exactly at the first target (a new toast never slides in from elsewhere) and
 * then follows each new target smoothly - the same toast moving with its anchor (above the keyboard ↔ the screen's own
 * bottom), never a new toast and never a new timer. `bottom` is a layout property, so not the native driver.
 */
export function useAnimatedToastBottom(target: number): Animated.Value {
  const bottom = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    const animation = Animated.timing(bottom, { duration: TOAST_ANCHOR_MOVE_MS, easing: Easing.out(Easing.cubic), toValue: target, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [bottom, target]);
  return bottom;
}
