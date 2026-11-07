import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { StarIcon } from '../icons/StarIcon';
import { useReduceMotion } from './useReduceMotion';
import { colors } from '../theme/tokens';

interface FavoriteStarProps {
  readonly active: boolean;
  readonly size?: number;
  /** Outline colour while not a favorite. */
  readonly inactiveColor?: string;
  /**
   * Bumped by the screen ONLY when the person taps this star. A change of `active` that is not preceded by a bump
   * (first render, list re-render, a server rollback, a bulk action) is drawn instantly with no effect.
   */
  readonly playToken?: number;
  readonly testID?: string;
}

const STAR_POINTS = '12 3 14.6 8.9 21 9.6 16.2 13.9 17.5 20.2 12 17 6.5 20.2 7.8 13.9 3 9.6 9.4 8.9';
/** The Juple wordmark gradient (apps/web globals.css .stateWordmark): coral -> pink -> violet. */
export const JUPLE_GRADIENT = ['#ff6a5c', '#f2389a', '#6a5cff'] as const;
const PARTICLES = 8;
const PENDING_TTL_MS = 1500;
// Timings (ms). ON ~270 in total (was ~420), OFF ~190 (was ~260): every part scaled by about 0.65-0.7, same shapes and particles.
const ON_POP_MS = 75;
const ON_FILL_MS = 100;
const ON_BURST_MS = 270;
const OFF_SHRINK_MS = 75;
const OFF_RESTORE_MS = 115;
const OFF_FILL_MS = 190;
let gradientCounter = 0;

/**
 * The favorite star. It only DRAWS the state it is given; the screen still owns the toggle, the optimistic flip and
 * its rollback.
 *  - ON  (~270ms): shrinks to 0.85, springs to 1.25 and back to 1, fills with the Juple gradient and bursts 8 particles
 *    (alternating dots and short rays) radially around the star, shrinking and fading as they go.
 *  - OFF (~190ms): 1 -> 0.85 -> 1 while the gradient is drawn into the centre, leaving the outline. No particles.
 *  - Reduce Motion: no scale and no particles, a short cross-fade only.
 * Everything runs on the native driver (transform / opacity only), so the JS thread is not involved while it plays.
 * Nothing here is clipped: the particle layer is a zero-size overflow-visible overlay centred on the star.
 */
export function FavoriteStar({ active, size = 20, inactiveColor = colors.border, playToken = 0, testID }: FavoriteStarProps) {
  const reduceMotion = useReduceMotion();
  const gradientId = useMemo(() => `favoriteStarGradient${gradientCounter++}`, []);
  const scale = useRef(new Animated.Value(1)).current;
  const fill = useRef(new Animated.Value(active ? 1 : 0)).current;
  const fillScale = useRef(new Animated.Value(active ? 1 : 0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const lastActive = useRef(active);
  const seenToken = useRef(playToken);
  const pending = useRef(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current); }, []);

  useEffect(() => {
    if (playToken !== seenToken.current) {
      seenToken.current = playToken;
      pending.current = true;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      // A tap whose request never changes the state (disabled, failed before the flip) must not arm a later, unrelated change.
      pendingTimer.current = setTimeout(() => { pending.current = false; }, PENDING_TTL_MS);
    }
    if (active === lastActive.current) {
      return;
    }
    lastActive.current = active;
    scale.stopAnimation();
    fill.stopAnimation();
    fillScale.stopAnimation();
    burst.stopAnimation();
    burst.setValue(0);
    const userTap = pending.current;
    pending.current = false;
    if (!userTap) {
      scale.setValue(1);
      fill.setValue(active ? 1 : 0);
      fillScale.setValue(active ? 1 : 0);
      return;
    }
    if (reduceMotion) {
      scale.setValue(1);
      fillScale.setValue(1);
      Animated.timing(fill, { duration: 120, toValue: active ? 1 : 0, useNativeDriver: true }).start();
      return;
    }
    if (active) {
      fillScale.setValue(1);
      scale.setValue(0.85);
      Animated.parallel([
        Animated.timing(fill, { duration: ON_FILL_MS, toValue: 1, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(scale, { duration: ON_POP_MS, easing: Easing.out(Easing.quad), toValue: 1.25, useNativeDriver: true }),
          // A stiffer, better-damped spring than before (it used to wobble for ~300ms): settles in roughly 150ms without a hard stop.
          Animated.spring(scale, { friction: 9, tension: 420, toValue: 1, useNativeDriver: true }),
        ]),
        Animated.timing(burst, { duration: ON_BURST_MS, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }),
      ]).start();
    } else {
      scale.setValue(1);
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { duration: OFF_SHRINK_MS, easing: Easing.out(Easing.quad), toValue: 0.85, useNativeDriver: true }),
          Animated.timing(scale, { duration: OFF_RESTORE_MS, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }),
        ]),
        Animated.timing(fill, { duration: OFF_FILL_MS, easing: Easing.out(Easing.quad), toValue: 0, useNativeDriver: true }),
        Animated.timing(fillScale, { duration: OFF_FILL_MS, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver: true }),
      ]).start();
    }
  }, [active, burst, fill, fillScale, playToken, reduceMotion, scale]);

  // Particle geometry is based on at least 22dp, so the burst of a small badge star (13dp on a Collection tile) is still clearly visible.
  const base = Math.max(size, 22);
  const dot = Math.round(base * 0.2);
  const rayLength = Math.round(base * 0.38);
  const rayWidth = Math.max(2.5, base * 0.1);
  const inner = base * 0.62;
  const outer = base * 1.25;
  const outline = active ? JUPLE_GRADIENT[1] : inactiveColor;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.box, { height: size, width: size }]} testID={testID}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <StarIcon color={outline} size={size} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fill, transform: [{ scale: fillScale }] }]}>
          <Svg height={size} viewBox="0 0 24 24" width={size}>
            <Defs>
              <LinearGradient id={gradientId} x1="3" x2="21" y1="20" y2="4">
                <Stop offset="0" stopColor={JUPLE_GRADIENT[0]} />
                <Stop offset="0.5" stopColor={JUPLE_GRADIENT[1]} />
                <Stop offset="1" stopColor={JUPLE_GRADIENT[2]} />
              </LinearGradient>
            </Defs>
            <Polygon fill={`url(#${gradientId})`} points={STAR_POINTS} stroke={`url(#${gradientId})`} strokeLinejoin="round" strokeWidth={1.75} />
          </Svg>
        </Animated.View>
      </Animated.View>
      {!reduceMotion ? (
        // Zero-size overlay centred on the star: particles are positioned from its centre, so no parent box has to be big
        // enough and nothing depends on the star's own bounds. zIndex keeps it above sibling badges.
        <View pointerEvents="none" style={styles.overlay} testID={testID ? `${testID}-burst` : undefined}>
          {Array.from({ length: PARTICLES }, (_, index) => {
            const isRay = index % 2 === 1;
            const degrees = (360 / PARTICLES) * index;
            const length = isRay ? rayLength : dot;
            const width = isRay ? rayWidth : dot;
            return (
              <Animated.View
                key={index}
                style={{
                  backgroundColor: JUPLE_GRADIENT[index % 3],
                  borderRadius: width,
                  height: length,
                  left: -width / 2,
                  opacity: burst.interpolate({ inputRange: [0, 0.08, 0.6, 1], outputRange: [0, 1, 0.85, 0] }),
                  position: 'absolute',
                  top: -length / 2,
                  transform: [
                    { rotate: `${degrees}deg` },
                    { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [-inner, -outer] }) },
                    { scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1, 0.45] }) },
                  ],
                  width,
                }}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  overlay: { alignItems: 'center', height: 0, justifyContent: 'center', overflow: 'visible', position: 'absolute', width: 0, zIndex: 10 },
});

/** [token, bump]: pass the token to <FavoriteStar playToken>, call bump() from the star's own onPress. */
export function useStarTap(): readonly [number, () => void] {
  const [token, setToken] = useState(0);
  const bump = useCallback(() => setToken(value => value + 1), []);
  return [token, bump];
}
