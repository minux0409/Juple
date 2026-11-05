import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { JupleBrandMark, type JupleBrandMarkSize } from './JupleBrandMark';
import { useReduceMotion } from './useReduceMotion';

/** One bounce: press down (~170ms), spring up (~150ms), settle (~300ms) - then a calm pause before the next one. */
const SQUASH_MS = 170;
const STRETCH_MS = 150;
const PAUSE_MS = 650;
/** How far it gives: a little lower, flatter and wider, then a little higher and taller - never more than ~14% out of shape. */
const SQUASH = { scaleX: 1.1, scaleY: 0.86, translateY: 6 } as const;
const STRETCH = { scaleX: 0.95, scaleY: 1.06, translateY: -10 } as const;

interface JellyBrandMarkProps {
  readonly size?: JupleBrandMarkSize;
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The Juple lockup bouncing like soft jelly while something loads: it presses down (flatter, wider), springs up (taller, narrower)
 * and settles back to its exact own shape, then waits and repeats. The artwork itself is the unchanged JupleBrandMark - only the
 * view around it is transformed for a moment.
 *
 * Purely decorative and independent of the work it accompanies: it never waits for, delays or signals progress (the caller's real
 * progress UI does that), it stops when unmounted, and it runs on the native driver so the JS thread doing the work is not involved.
 * With Reduce Motion (iOS) / Remove animations (Android) the mark simply stands still.
 */
export function JellyBrandMark({ size = 'medium', style }: JellyBrandMarkProps) {
  const reduceMotion = useReduceMotion();
  const scaleX = useRef(new Animated.Value(1)).current;
  const scaleY = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scaleX.setValue(1);
    scaleY.setValue(1);
    translateY.setValue(0);
    if (reduceMotion) {
      return undefined;
    }
    const to = (value: Animated.Value, toValue: number, duration: number, easing: (t: number) => number) =>
      Animated.timing(value, { toValue, duration, easing, useNativeDriver: true });
    const settle = (value: Animated.Value, toValue: number, damping: number) =>
      Animated.spring(value, { toValue, damping, stiffness: 240, mass: 0.8, useNativeDriver: true, restDisplacementThreshold: 0.002, restSpeedThreshold: 0.01 });
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          to(scaleX, SQUASH.scaleX, SQUASH_MS, Easing.inOut(Easing.quad)),
          to(scaleY, SQUASH.scaleY, SQUASH_MS, Easing.inOut(Easing.quad)),
          to(translateY, SQUASH.translateY, SQUASH_MS, Easing.inOut(Easing.quad)),
        ]),
        Animated.parallel([
          to(scaleX, STRETCH.scaleX, STRETCH_MS, Easing.out(Easing.quad)),
          to(scaleY, STRETCH.scaleY, STRETCH_MS, Easing.out(Easing.quad)),
          to(translateY, STRETCH.translateY, STRETCH_MS, Easing.out(Easing.quad)),
        ]),
        Animated.parallel([settle(scaleX, 1, 7), settle(scaleY, 1, 7), settle(translateY, 0, 10)]),
        Animated.delay(PAUSE_MS),
      ]),
    );
    bounce.start();
    return () => bounce.stop();
  }, [reduceMotion, scaleX, scaleY, translateY]);

  return (
    <Animated.View style={[style, { transform: [{ translateY }, { scaleX }, { scaleY }] }]} testID="jelly-brand-mark">
      <JupleBrandMark size={size} />
    </Animated.View>
  );
}
