import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type PressableProps } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Pressable } from '../components/Pressable';
import { useReduceMotion } from '../components/useReduceMotion';
import { useTheme } from '../theme/ThemeContext';
import { BRAND_GRADIENT_STOPS } from '../theme/tokens';

/**
 * The selected tab's "jelly" indicator: a soft pill in the brand gradient behind the tab's icon that squishes into place when its
 * tab is chosen, while the previous tab's pill shrinks away - so the highlight visibly passes from one tab to the other.
 *
 * Who does what:
 *  - JellyTabPressable (the tab's button) owns the motion: it knows whether its tab is selected (`aria-selected`, set by the tab
 *    bar) and drives three native-driver values - nothing here re-renders per frame, so a low-end Android phone keeps 60fps.
 *  - JellyTabIcon (inside the button, via the tab's tabBarIcon) draws the pill and scales the icon from those values. The tab bar
 *    draws every icon twice (selected and unselected look, swapped by opacity); both copies read the same values, so whichever copy
 *    is visible shows the motion and nothing is doubled.
 *
 * Navigation never waits for it: the press is handled by the tab bar as before and the animation only follows the new selection.
 * A new selection simply restarts the values from wherever they are, so fast repeated taps never queue up or end half-way.
 * Reduce Motion (iOS) / Remove animations (Android): the pill and icon jump straight to their resting state.
 */
interface JellyMotion {
  /** 0 = no pill, 1 = the resting pill; a spring overshoots slightly past 1 on the way in. */
  readonly pill: Animated.Value;
  /** 0 = round, 1 = pressed flat (wider, lower) - the squash of the jelly as it lands. */
  readonly squash: Animated.Value;
  readonly iconScale: Animated.Value;
}

const JellyMotionContext = createContext<JellyMotion | null>(null);

/** Total motion ~300ms: the press-in and icon pop take ~100ms, the springs settle visibly within ~200ms after. */
const SQUASH_IN_MS = 90;
const ICON_POP_MS = 110;
const DESELECT_MS = 170;
const ICON_POP_SCALE = 1.12;
const SPRING_REST = { restDisplacementThreshold: 0.01, restSpeedThreshold: 0.01 } as const;

function useJellyMotion(selected: boolean): JellyMotion {
  const reduceMotion = useReduceMotion();
  // Created once per button; the initial selection starts at rest (no animation on the first frame or on a re-mount).
  const motion = useRef<JellyMotion | null>(null);
  if (motion.current === null) {
    motion.current = { pill: new Animated.Value(selected ? 1 : 0), squash: new Animated.Value(0), iconScale: new Animated.Value(1) };
  }
  const isFirstRun = useRef(true);

  useEffect(() => {
    const { pill, squash, iconScale } = motion.current!;
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // Restart from wherever a previous (interrupted) motion left the values.
    pill.stopAnimation();
    squash.stopAnimation();
    iconScale.stopAnimation();
    if (reduceMotion) {
      pill.setValue(selected ? 1 : 0);
      squash.setValue(0);
      iconScale.setValue(1);
      return;
    }
    const animation = selected
      ? Animated.parallel([
          Animated.spring(pill, { toValue: 1, damping: 11, stiffness: 260, mass: 0.7, useNativeDriver: true, ...SPRING_REST }),
          Animated.sequence([
            Animated.timing(squash, { toValue: 1, duration: SQUASH_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(squash, { toValue: 0, damping: 7, stiffness: 320, mass: 0.6, useNativeDriver: true, ...SPRING_REST }),
          ]),
          Animated.sequence([
            Animated.timing(iconScale, { toValue: ICON_POP_SCALE, duration: ICON_POP_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.spring(iconScale, { toValue: 1, damping: 9, stiffness: 280, useNativeDriver: true, ...SPRING_REST }),
          ]),
        ])
      : Animated.parallel([
          Animated.timing(pill, { toValue: 0, duration: DESELECT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(squash, { toValue: 0, duration: DESELECT_MS, useNativeDriver: true }),
          Animated.timing(iconScale, { toValue: 1, duration: DESELECT_MS, useNativeDriver: true }),
        ]);
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, selected]);

  // Reduce Motion switched on while a pill was mid-way: settle it now.
  useEffect(() => {
    if (!reduceMotion) {
      return;
    }
    const { pill, squash, iconScale } = motion.current!;
    pill.setValue(selected ? 1 : 0);
    squash.setValue(0);
    iconScale.setValue(1);
  }, [reduceMotion, selected]);

  return motion.current;
}

type JellyTabPressableProps = PressableProps & { readonly 'aria-selected'?: boolean; readonly children?: ReactNode };

/** A tab button: the app Pressable (its touch area, label and accessibility props unchanged) plus the jelly motion of its tab. */
export function JellyTabPressable({ children, ...props }: JellyTabPressableProps) {
  const motion = useJellyMotion(props['aria-selected'] === true);
  return (
    <Pressable {...props}>
      <JellyMotionContext.Provider value={motion}>{children}</JellyMotionContext.Provider>
    </Pressable>
  );
}

/** The pill behind a tab icon: wider than the icon, centred on it. */
export const JELLY_PILL_WIDTH = 56;
export const JELLY_PILL_HEIGHT = 30;

/** The tab's icon with the jelly pill behind it; `focused` is the copy the tab bar shows while the tab is selected. */
export function JellyTabIcon({ focused, size, children }: { readonly focused: boolean; readonly size: number; readonly children: ReactNode }) {
  const motion = useContext(JellyMotionContext);
  if (!motion) {
    return <>{children}</>;
  }
  const { pill, squash, iconScale } = motion;
  const pillStyle = {
    opacity: pill.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [
      { scaleX: Animated.multiply(pill.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] })) },
      { scaleY: Animated.multiply(pill.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] })) },
    ],
  };
  return (
    <View style={[styles.iconBox, { height: size, width: size }]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.pill, { left: (size - JELLY_PILL_WIDTH) / 2, top: (size - JELLY_PILL_HEIGHT) / 2 }, pillStyle]}
        testID="jelly-tab-pill"
      >
        <JellyPillShape />
      </Animated.View>
      {/* Only the selected look pops; the unselected copy keeps its plain size. */}
      <Animated.View style={focused ? { transform: [{ scale: iconScale }] } : null}>{children}</Animated.View>
    </View>
  );
}

/** The pill itself: the brand gradient (pink -> violet -> blue, diagonal like the wordmark) as a soft fill with a slightly stronger rim. */
function JellyPillShape() {
  const { isDark } = useTheme();
  const gradientId = `jelly${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const [pink, violet, blue] = BRAND_GRADIENT_STOPS;
  const radius = JELLY_PILL_HEIGHT / 2;
  return (
    <Svg height={JELLY_PILL_HEIGHT} width={JELLY_PILL_WIDTH}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor={pink} />
          <Stop offset="0.55" stopColor={violet} />
          <Stop offset="1" stopColor={blue} />
        </LinearGradient>
      </Defs>
      <Rect
        fill={`url(#${gradientId})`}
        fillOpacity={isDark ? 0.34 : 0.2}
        height={JELLY_PILL_HEIGHT - 1}
        rx={radius - 0.5}
        stroke={`url(#${gradientId})`}
        strokeOpacity={isDark ? 0.55 : 0.4}
        strokeWidth={1}
        width={JELLY_PILL_WIDTH - 1}
        x={0.5}
        y={0.5}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  pill: { height: JELLY_PILL_HEIGHT, position: 'absolute', width: JELLY_PILL_WIDTH },
});
