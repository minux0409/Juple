import { BottomTabBar, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  createContext,
  type ComponentRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type PressableProps } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { Pressable } from '../components/Pressable';
import { useReduceMotion } from '../components/useReduceMotion';
import { useTheme } from '../theme/ThemeContext';
import { BRAND_GRADIENT_STOPS, colors, radii, themedStyles } from '../theme/tokens';
import { buildLayerPaths, type BlobLayerPaths } from './jellyBlobGeometry';

/**
 * The selected tab's liquid blob.
 *
 * How it is built (and why it is not a shape that slides):
 *  - ONE blob is shared by the whole tab bar (JellyTabBar draws it behind the tabs). Each tab button reports where its icon + label block
 *    really is (measured, so a longer label in another language makes a wider blob) and the blob settles around the selected one.
 *  - The blob is a path whose Bezier points are rebuilt every frame (jellyBlobGeometry): its LEFT and RIGHT edges are two separate springs.
 *    Moving right, the right edge is the leading edge (stiff, quick) and the left edge the trailing one (soft, late), so the drop first
 *    stretches toward its destination, thins into a waist in the middle with a heavier head, then the tail is dragged in and the shape
 *    gathers again; a small landing pulse spreads it and it settles into the irregular resting stain. A change of direction mid-way simply
 *    gives both springs new targets from where they are - the shape is continuous.
 *  - A far jump never makes a long bar: the stretch is capped (the trailing edge is dragged along).
 *  - The frames are painted straight into the SVG paths (setNativeProps, driven by the Animated springs on the JS thread) - no React
 *    render per frame. The icon's little pop stays a native-driver transform on the button.
 * Navigation never waits for any of it: the tab press is handled by the tab bar as before.
 * Reduce Motion (iOS) / Remove animations (Android): the blob just jumps to the selected tab, no deformation.
 */

type ViewHandle = ComponentRef<typeof View>;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface JellyBar {
  readonly wrapperRef: RefObject<ViewHandle | null>;
  readonly register: (index: number, rect: Rect) => void;
  /** Bumped when the bar's own size changes, so every tab measures itself again. */
  readonly layoutVersion: number;
}

const JellyBarContext = createContext<JellyBar | null>(null);
const IconPopContext = createContext<Animated.Value | null>(null);

/** Breathing room around the icon + label block (dp). */
const PAD_X = 11;
const PAD_Y = 7;
const TAB_COUNT = 4;
/** The liquid never leaves the bar: this much margin to the screen edges (dp). */
const BAR_EDGE = 3;

// ---- the button -----------------------------------------------------------------------------------------------------------------------

const ICON_POP_MS = 110;
const DESELECT_MS = 170;
const ICON_POP_SCALE = 1.12;
const SPRING_REST = { restDisplacementThreshold: 0.01, restSpeedThreshold: 0.01 } as const;

/** The icon's pop when its tab is chosen (a native-driver transform; the blob has its own motion in the bar). */
function useIconPop(selected: boolean): Animated.Value {
  const reduceMotion = useReduceMotion();
  const scale = useRef<Animated.Value | null>(null);
  if (scale.current === null) {
    scale.current = new Animated.Value(1);
  }
  const isFirstRun = useRef(true);
  useEffect(() => {
    const value = scale.current!;
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    value.stopAnimation();
    if (reduceMotion || !selected) {
      if (reduceMotion) {
        value.setValue(1);
        return;
      }
      const settle = Animated.timing(value, { toValue: 1, duration: DESELECT_MS, useNativeDriver: true });
      settle.start();
      return () => settle.stop();
    }
    const pop = Animated.sequence([
      Animated.timing(value, { toValue: ICON_POP_SCALE, duration: ICON_POP_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(value, { toValue: 1, damping: 9, stiffness: 280, useNativeDriver: true, ...SPRING_REST }),
    ]);
    pop.start();
    return () => pop.stop();
  }, [reduceMotion, selected]);
  return scale.current;
}

type JellyTabPressableProps = PressableProps & { readonly 'aria-selected'?: boolean; readonly children?: ReactNode; /** Position in the bar (0-based, left to right). */ readonly jellyIndex: number };

/** A tab button: the app Pressable (its touch area, label and accessibility props unchanged) around the icon + label block the blob wraps. */
export function JellyTabPressable({ children, jellyIndex, ...props }: JellyTabPressableProps) {
  const iconScale = useIconPop(props['aria-selected'] === true);
  const bar = useContext(JellyBarContext);
  const contentRef = useRef<ViewHandle>(null);
  const layoutVersion = bar?.layoutVersion;

  const report = useCallback(() => {
    const node = contentRef.current;
    const wrapper = bar?.wrapperRef.current;
    if (!bar || !node || !wrapper || typeof node.measureLayout !== 'function') {
      return;
    }
    node.measureLayout(wrapper, (x, y, width, height) => bar.register(jellyIndex, { x, y, width, height }), () => undefined);
  }, [bar, jellyIndex]);
  // Measured again when the block changes size (a longer label) and when the whole bar did (rotation, split screen).
  useEffect(() => {
    report();
  }, [report, layoutVersion]);

  return (
    <Pressable {...props} style={typeof props.style === 'function' ? props.style : [props.style, styles.buttonShape]}>
      {/* The icon + label block, exactly as big as its content (the blob is drawn around THIS block, in the bar behind the buttons). */}
      <View collapsable={false} onLayout={report} ref={contentRef} style={styles.content}>
        <IconPopContext.Provider value={iconScale}>{children}</IconPopContext.Provider>
      </View>
    </Pressable>
  );
}

/** The tab's icon; the selected look pops as its tab is chosen. */
export function JellyTabIcon({ focused, size, children }: { readonly focused: boolean; readonly size: number; readonly children: ReactNode }) {
  const iconScale = useContext(IconPopContext);
  if (!iconScale) {
    return <>{children}</>;
  }
  return (
    <View style={[styles.iconBox, { height: size, width: size }]}>
      {/* Only the selected look pops; the unselected copy keeps its plain size. */}
      <Animated.View style={focused ? { transform: [{ scale: iconScale }] } : null}>{children}</Animated.View>
    </View>
  );
}

// ---- the bar --------------------------------------------------------------------------------------------------------------------------

/** The tab bar: its own background, the shared blob behind the tabs, then the navigator's bar (transparent) with the buttons on top. */
export function JellyTabBar(props: BottomTabBarProps) {
  useTheme();
  const wrapperRef = useRef<ViewHandle>(null);
  const rects = useRef(new Map<number, Rect>());
  const [rectVersion, setRectVersion] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const register = useCallback((index: number, rect: Rect) => {
    const previous = rects.current.get(index);
    if (previous && previous.x === rect.x && previous.y === rect.y && previous.width === rect.width && previous.height === rect.height) {
      return;
    }
    rects.current.set(index, rect);
    setRectVersion(version => version + 1);
  }, []);
  const bar = useMemo<JellyBar>(() => ({ wrapperRef, register, layoutVersion }), [register, layoutVersion]);
  const onBarLayout = useCallback((_event: LayoutChangeEvent) => setLayoutVersion(version => version + 1), []);

  return (
    <View collapsable={false} onLayout={onBarLayout} ref={wrapperRef} style={styles.bar}>
      <JellyBlobLayer rectVersion={rectVersion} rects={rects} selectedIndex={props.state.index} />
      <JellyBarContext.Provider value={bar}>
        <BottomTabBar {...props} />
      </JellyBarContext.Provider>
    </View>
  );
}

// ---- the blob -------------------------------------------------------------------------------------------------------------------------

/**
 * Spring of the edge that leads (races ahead, a little underdamped: it overshoots and sloshes back on landing) and of the one that trails
 * (soft, and it only lets go TRAIL_DELAY_MS later, so for a moment the tail is still on the old tab while the head is already away).
 * Positions are in dp.
 */
const LEADING_SPRING = { stiffness: 300, damping: 19, mass: 1 } as const;
const TRAILING_SPRING = { stiffness: 160, damping: 20, mass: 1 } as const;
const TRAIL_DELAY_MS = 55;
const BLOB_SPRING_REST = { restDisplacementThreshold: 0.4, restSpeedThreshold: 0.6 } as const;

interface BlobTarget {
  readonly left: number;
  readonly right: number;
  readonly centerY: number;
  readonly halfHeight: number;
}

function targetOf(rect: Rect, barWidth: number): BlobTarget {
  return {
    left: Math.max(rect.x - PAD_X, BAR_EDGE),
    right: Math.min(rect.x + rect.width + PAD_X, barWidth - BAR_EDGE),
    centerY: rect.y + rect.height / 2,
    halfHeight: rect.height / 2 + PAD_Y,
  };
}

interface ShapeProps {
  readonly d?: string;
}
type ShapeHandle = { setNativeProps: (props: ShapeProps) => void };

function JellyBlobLayer({ selectedIndex, rects, rectVersion }: { readonly selectedIndex: number; readonly rects: RefObject<Map<number, Rect>>; readonly rectVersion: number }) {
  const { isDark } = useTheme();
  const reduceMotion = useReduceMotion();
  const { width: windowWidth } = useWindowDimensions();
  const uid = `jelly${useId().replace(/[^A-Za-z0-9]/g, '')}`;
  const [pink, violet, blue] = BRAND_GRADIENT_STOPS;

  const values = useRef<{ left: Animated.Value; right: Animated.Value; pop: Animated.Value } | null>(null);
  if (values.current === null) {
    values.current = { left: new Animated.Value(0), right: new Animated.Value(0), pop: new Animated.Value(0) };
  }
  // The live state read by the painter; the Animated values write into it through their listeners.
  const live = useRef({
    left: 0,
    right: 0,
    pop: 0,
    restWidth: 0,
    restHalfHeight: 0,
    centerY: 0,
    leadsRight: true,
    maxExtraLength: 0,
    maxX: 0,
  });
  const shapeRefs = useRef<Record<string, ShapeHandle | null>>({});
  const frameRequest = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const shown = useRef<{ index: number; target: BlobTarget } | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const [initialLayers, setInitialLayers] = useState<BlobLayerPaths | undefined>(undefined);

  const currentLayers = useCallback((): BlobLayerPaths => {
    const state = live.current;
    return buildLayerPaths({
      left: state.left,
      right: state.right,
      restWidth: state.restWidth,
      restHalfHeight: state.restHalfHeight,
      centerY: state.centerY,
      pop: state.pop,
      leadsRight: state.leadsRight,
      maxExtraLength: state.maxExtraLength,
      minX: BAR_EDGE,
      maxX: state.maxX,
    });
  }, []);

  const paint = useCallback(() => {
    frameRequest.current = null;
    const layers = currentLayers();
    const refs = shapeRefs.current;
    // Every colour/depth layer that wears the silhouette, then the ones with their own geometry.
    for (const key of BODY_LAYERS) {
      refs[key]?.setNativeProps({ d: layers.body });
    }
    refs.rim?.setNativeProps({ d: layers.rim });
    refs.highlight?.setNativeProps({ d: layers.highlight });
    refs.spot?.setNativeProps({ d: layers.spot });
  }, [currentLayers]);
  const schedulePaint = useCallback(() => {
    if (frameRequest.current === null) {
      frameRequest.current = requestAnimationFrame(paint);
    }
  }, [paint]);

  useEffect(() => {
    const { left, right, pop } = values.current!;
    const ids = [
      left.addListener(({ value }) => { live.current.left = value; schedulePaint(); }),
      right.addListener(({ value }) => { live.current.right = value; schedulePaint(); }),
      pop.addListener(({ value }) => { live.current.pop = value; schedulePaint(); }),
    ];
    return () => {
      left.removeListener(ids[0]);
      right.removeListener(ids[1]);
      pop.removeListener(ids[2]);
      running.current?.stop();
      if (frameRequest.current !== null) {
        cancelFrame(frameRequest.current);
      }
    };
  }, [schedulePaint]);

  useEffect(() => {
    const rect = rects.current?.get(selectedIndex);
    if (!rect) {
      return;
    }
    const target = targetOf(rect, windowWidth);
    const previous = shown.current;
    if (previous && previous.index === selectedIndex && sameTarget(previous.target, target)) {
      return;
    }
    const { left, right, pop } = values.current!;
    const state = live.current;
    state.restWidth = target.right - target.left;
    state.restHalfHeight = target.halfHeight;
    state.centerY = target.centerY;
    state.maxExtraLength = (windowWidth / TAB_COUNT) * 0.9;
    state.maxX = windowWidth - BAR_EDGE;

    const settleNow = () => {
      running.current?.stop();
      running.current = null;
      left.setValue(target.left);
      right.setValue(target.right);
      pop.setValue(0);
      state.left = target.left;
      state.right = target.right;
      state.pop = 0;
      state.leadsRight = true;
      if (previous === null) {
        setInitialLayers(currentLayers());
      } else {
        paint();
      }
    };

    if (previous === null || reduceMotion || previous.index === selectedIndex) {
      shown.current = { index: selectedIndex, target };
      settleNow();
      return;
    }
    shown.current = { index: selectedIndex, target };

    // Retarget both edges from wherever they are now (a direction change mid-way stays continuous).
    running.current?.stop();
    left.stopAnimation();
    right.stopAnimation();
    pop.stopAnimation();
    const leadsRight = (target.left + target.right) / 2 >= (state.left + state.right) / 2;
    state.leadsRight = leadsRight;
    // A far jump is a little less brisk (same damping ratio), so three tabs of travel do not become a one-frame flash.
    const distance = Math.abs((target.left + target.right) / 2 - (state.left + state.right) / 2);
    const pace = Math.min(1, Math.max(0.4, (1.4 * (windowWidth / TAB_COUNT)) / Math.max(distance, 1)));
    const animation = Animated.parallel([
      edgeSpring(left, target.left, leadsRight ? 'trailing' : 'leading', pace),
      edgeSpring(right, target.right, leadsRight ? 'leading' : 'trailing', pace),
      // Pressed in as it sets off, relaxed while it travels, then a spread and a rebound as it lands.
      Animated.sequence([
        Animated.timing(pop, { toValue: -0.8, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(pop, { toValue: 0, duration: 110, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.delay(40),
        Animated.timing(pop, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.spring(pop, { toValue: 0, stiffness: 230, damping: 7, mass: 0.8, restDisplacementThreshold: 0.01, restSpeedThreshold: 0.05, useNativeDriver: false }),
      ]),
    ]);
    running.current = animation;
    animation.start(({ finished }) => {
      if (finished) {
        running.current = null;
        state.left = target.left;
        state.right = target.right;
        state.pop = 0;
        paint();
      }
    });
  }, [currentLayers, paint, reduceMotion, rectVersion, rects, selectedIndex, windowWidth]);

  if (initialLayers === undefined) {
    return null;
  }
  const id = (name: string) => `${uid}${name}`;
  const ref = (key: string) => (instance: unknown) => { shapeRefs.current[key] = instance as ShapeHandle | null; };
  const glow = isDark ? 1.5 : 1;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="jelly-tab-blob">
      <Svg height="100%" width="100%">
        <Defs>
          {/* the base: pink -> violet -> blue, but only the foundation - the colours are mixed by the overlays below */}
          <LinearGradient id={id('base')} x1="0" x2="1" y1="0" y2="1">
            <Stop offset="0" stopColor={pink} />
            <Stop offset="0.55" stopColor={violet} />
            <Stop offset="1" stopColor={blue} />
          </LinearGradient>
          <RadialGradient cx="0.2" cy="0.3" id={id('pink')} r="0.62">
            <Stop offset="0" stopColor={pink} stopOpacity={isDark ? 0.5 : 0.48} />
            <Stop offset="1" stopColor={pink} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient cx="0.82" cy="0.78" id={id('blue')} r="0.66">
            <Stop offset="0" stopColor={blue} stopOpacity={isDark ? 0.5 : 0.48} />
            <Stop offset="1" stopColor={blue} stopOpacity={0} />
          </RadialGradient>
          {/* thickness: the surface darkens toward the lower rim, as a bulging body does */}
          <RadialGradient cx="0.5" cy="-0.05" id={id('shade')} r="1.12">
            <Stop offset="0" stopColor={violet} stopOpacity={0} />
            <Stop offset="0.5" stopColor={violet} stopOpacity={0} />
            <Stop offset="1" stopColor={violet} stopOpacity={isDark ? 0.5 : 0.36} />
          </RadialGradient>
          <LinearGradient id={id('hl')} x1="0" x2="0.35" y1="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={isDark ? 0.55 : 0.95} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={isDark ? 0.05 : 0.15} />
          </LinearGradient>
        </Defs>
        {/* soft outer glow without any blur filter (not reliable on older Android): three strokes, wider and fainter outward */}
        <Path d={initialLayers.body} fill="none" ref={ref('glowA')} stroke={violet} strokeLinejoin="round" strokeOpacity={0.05 * glow} strokeWidth={11} />
        <Path d={initialLayers.body} fill="none" ref={ref('glowB')} stroke={violet} strokeLinejoin="round" strokeOpacity={0.08 * glow} strokeWidth={6.5} />
        <Path d={initialLayers.body} fill="none" ref={ref('glowC')} stroke={violet} strokeLinejoin="round" strokeOpacity={0.12 * glow} strokeWidth={3} />
        <Path d={initialLayers.body} fill={`url(#${id('base')})`} fillOpacity={isDark ? 0.36 : 0.24} ref={ref('base')} />
        <Path d={initialLayers.body} fill={`url(#${id('pink')})`} ref={ref('pinkTint')} />
        <Path d={initialLayers.body} fill={`url(#${id('blue')})`} ref={ref('blueTint')} />
        <Path d={initialLayers.body} fill={`url(#${id('shade')})`} ref={ref('shade')} />
        <Path d={initialLayers.body} fill="none" ref={ref('edge')} stroke={`url(#${id('base')})`} strokeOpacity={isDark ? 0.6 : 0.5} strokeWidth={1.1} />
        <Path d={initialLayers.rim} fill="none" ref={ref('rim')} stroke="#FFFFFF" strokeOpacity={isDark ? 0.18 : 0.5} strokeWidth={0.9} />
        <Path d={initialLayers.highlight} fill={`url(#${id('hl')})`} ref={ref('highlight')} />
        <Path d={initialLayers.spot} fill="#FFFFFF" fillOpacity={isDark ? 0.45 : 0.85} ref={ref('spot')} />
      </Svg>
    </View>
  );
}

/** The layers that wear the silhouette itself (the rest - rim, highlight, spot - have their own geometry). */
const BODY_LAYERS = ['glowA', 'glowB', 'glowC', 'base', 'pinkTint', 'blueTint', 'shade', 'edge'] as const;

/** A spring on one blob edge; the trailing edge waits a moment before letting go of the old tab. */
function edgeSpring(value: Animated.Value, toValue: number, role: 'leading' | 'trailing', pace: number): Animated.CompositeAnimation {
  const base = role === 'leading' ? LEADING_SPRING : TRAILING_SPRING;
  const spring = Animated.spring(value, { toValue, stiffness: base.stiffness * pace, damping: base.damping * Math.sqrt(pace), mass: base.mass, ...BLOB_SPRING_REST, useNativeDriver: false });
  return role === 'leading' ? spring : Animated.sequence([Animated.delay(TRAIL_DELAY_MS), spring]);
}

function sameTarget(a: BlobTarget, b: BlobTarget): boolean {
  return Math.abs(a.left - b.left) < 0.5 && Math.abs(a.right - b.right) < 0.5 && Math.abs(a.centerY - b.centerY) < 0.5 && Math.abs(a.halfHeight - b.halfHeight) < 0.5;
}

function cancelFrame(handle: ReturnType<typeof requestAnimationFrame>) {
  cancelAnimationFrame(handle);
}

const styles = themedStyles(() => ({
  // The bar's own look (the navigator's bar on top of it is transparent): surface colour, hairline top border, soft shadow.
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.inputBorder,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  // The pressed state layer follows the button's own corner radii.
  buttonShape: { borderRadius: radii.md + 4 },
  content: { alignItems: 'center', justifyContent: 'center', maxWidth: '100%', minWidth: 66 },
}));
