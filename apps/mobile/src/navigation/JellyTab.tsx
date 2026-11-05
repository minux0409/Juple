import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View, type PressableProps } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { Pressable } from '../components/Pressable';
import { useReduceMotion } from '../components/useReduceMotion';
import { useTheme } from '../theme/ThemeContext';
import { BRAND_GRADIENT_STOPS, radii } from '../theme/tokens';

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
  /** Horizontal distance (px) from the tab the pill is coming from to this tab; springs to 0 so the pill flows in from the old tab. */
  readonly travel: Animated.Value;
  /** One tab's width: the pill is stretched along its path by up to this much travel. */
  readonly pitch: number;
}

/** The bar always has this many equal cells (Home, Archive, Collections, My Page). */
const TAB_COUNT = 4;
/** The tab selected last (module-wide: the four buttons are siblings that only know themselves) - where the next pill flows from. */
let lastSelectedTab = -1;
const MAX_STRETCH = 1.45;

const JellyMotionContext = createContext<JellyMotion | null>(null);

/** Total motion ~300ms: the press-in and icon pop take ~100ms, the springs settle visibly within ~200ms after. */
const SQUASH_IN_MS = 90;
const ICON_POP_MS = 110;
const DESELECT_MS = 170;
const ICON_POP_SCALE = 1.12;
const SPRING_REST = { restDisplacementThreshold: 0.01, restSpeedThreshold: 0.01 } as const;

function useJellyMotion(selected: boolean, jellyIndex: number): JellyMotion {
  const reduceMotion = useReduceMotion();
  const { width } = useWindowDimensions();
  const pitch = Math.max(width / TAB_COUNT, 1);
  // Created once per button; the initial selection starts at rest (no animation on the first frame or on a re-mount).
  const motion = useRef<JellyMotion | null>(null);
  if (motion.current === null) {
    motion.current = { pill: new Animated.Value(selected ? 1 : 0), squash: new Animated.Value(0), iconScale: new Animated.Value(1), travel: new Animated.Value(0), pitch };
    if (selected) {
      lastSelectedTab = jellyIndex;
    }
  }
  (motion.current as { pitch: number }).pitch = pitch;
  const isFirstRun = useRef(true);

  useEffect(() => {
    const { pill, squash, iconScale, travel } = motion.current!;
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    // Restart from wherever a previous (interrupted) motion left the values.
    pill.stopAnimation();
    squash.stopAnimation();
    iconScale.stopAnimation();
    travel.stopAnimation();
    const from = lastSelectedTab;
    if (selected) {
      lastSelectedTab = jellyIndex;
    }
    if (reduceMotion) {
      pill.setValue(selected ? 1 : 0);
      squash.setValue(0);
      iconScale.setValue(1);
      travel.setValue(0);
      return;
    }
    // The pill flows in from the tab that was selected before (visible straight away), instead of growing out of nothing.
    const flowsFromNeighbour = selected && from >= 0 && from !== jellyIndex;
    if (selected) {
      travel.setValue(flowsFromNeighbour ? (from - jellyIndex) * pitch : 0);
      if (flowsFromNeighbour) {
        pill.setValue(0.55);
      }
    }
    const animation = selected
      ? Animated.parallel([
          Animated.spring(travel, { toValue: 0, damping: 12, stiffness: 170, mass: 0.8, useNativeDriver: true, ...SPRING_REST }),
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
  }, [reduceMotion, selected, jellyIndex, pitch]);

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

type JellyTabPressableProps = PressableProps & { readonly 'aria-selected'?: boolean; readonly children?: ReactNode; /** Position in the bar (0-based, left to right). */ readonly jellyIndex: number };

/** A tab button: the app Pressable (its touch area, label and accessibility props unchanged) plus the jelly of its tab behind icon AND label. */
export function JellyTabPressable({ children, jellyIndex, ...props }: JellyTabPressableProps) {
  const motion = useJellyMotion(props['aria-selected'] === true, jellyIndex);
  const { pill, squash, travel, pitch } = motion;
  // Stretched along its path (liquid), relaxing to its round shape as it lands.
  const stretch = travel.interpolate({ inputRange: [-pitch, 0, pitch], outputRange: [MAX_STRETCH, 1, MAX_STRETCH], extrapolate: 'clamp' });
  const pillStyle = {
    opacity: pill.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
    transform: [
      { translateX: travel },
      { scaleX: Animated.multiply(Animated.multiply(pill.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] })), stretch) },
      { scaleY: Animated.multiply(pill.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }), squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.84] })) },
    ],
  };
  return (
    <Pressable {...props} style={typeof props.style === 'function' ? props.style : [props.style, styles.buttonShape]}>
      {/* The icon + label block, as wide and tall as its content. The blob is laid out around THIS block (not the button), so it always
          wraps icon and label together whatever the language: content size + padding, a minimum so a short label ("홈") does not
          give a tiny blob, and never wider than the tab. Smaller than the button because the padding is only a few dp. */}
      <View style={styles.content}>
        <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]} testID="jelly-tab-pill">
          <JellyPillShape />
        </Animated.View>
        <JellyMotionContext.Provider value={motion}>{children}</JellyMotionContext.Provider>
      </View>
    </Pressable>
  );
}

/** The tab's icon; the selected look pops as its tab is chosen (the blob behind icon and label belongs to the button). */
export function JellyTabIcon({ focused, size, children }: { readonly focused: boolean; readonly size: number; readonly children: ReactNode }) {
  const motion = useContext(JellyMotionContext);
  if (!motion) {
    return <>{children}</>;
  }
  return (
    <View style={[styles.iconBox, { height: size, width: size }]}>
      {/* Only the selected look pops; the unselected copy keeps its plain size. */}
      <Animated.View style={focused ? { transform: [{ scale: motion.iconScale }] } : null}>{children}</Animated.View>
    </View>
  );
}

/** Plump, slightly irregular blob (not a rectangle): a soft pill whose top and bottom bulge a little, in a 100x60 box stretched to the button. */
const BLOB_PATH =
  'M 28 4 C 42 0.5, 58 0.5, 72 4 C 90 8, 99 18, 99 30 C 99 43, 90 54, 72 57 C 58 60, 42 60, 28 57 C 10 54, 1 43, 1 30 C 1 18, 10 8, 28 4 Z';

/** The blob: the brand gradient (pink -> violet -> blue, diagonal like the wordmark) as a soft fill with a slightly stronger rim. */
function JellyPillShape() {
  const { isDark } = useTheme();
  const gradientId = `jelly${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const [pink, violet, blue] = BRAND_GRADIENT_STOPS;
  return (
    <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 100 60" width="100%">
      <Defs>
        <LinearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <Stop offset="0" stopColor={pink} />
          <Stop offset="0.55" stopColor={violet} />
          <Stop offset="1" stopColor={blue} />
        </LinearGradient>
      </Defs>
      <Path
        d={BLOB_PATH}
        fill={`url(#${gradientId})`}
        fillOpacity={isDark ? 0.34 : 0.2}
        stroke={`url(#${gradientId})`}
        strokeOpacity={isDark ? 0.55 : 0.4}
        strokeWidth={1}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  // The pressed state layer follows the button's own corner radii (it is no longer clipped by the tab item).
  buttonShape: { borderRadius: radii.md + 4 },
  content: { alignItems: 'center', justifyContent: 'center', maxWidth: '100%', minWidth: 64 },
  // Around the content block: a little outside it (padding), never inside it.
  pill: { bottom: -4, left: -8, position: 'absolute', right: -8, top: -5 },
});
