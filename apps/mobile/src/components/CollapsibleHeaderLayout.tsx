import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Animated, FlatList, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { colors } from '../theme/tokens';

/** A FlatList whose `onScroll` may be an `Animated.event` (native driver). Same props, generics and virtualization as FlatList. */
export const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;

export interface HeaderState {
  /** True once the collapsible part has scrolled completely away (only the pinned part is left on screen). */
  readonly isCollapsed: boolean;
  /** Scrolls the list back to its first row (the whole header comes back with it). */
  readonly scrollToTop: () => void;
}

export interface CollapsibleListBinding extends HeaderState {
  /** Pass to the list's `onScroll` (an Animated.event driven by the native thread). */
  readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  readonly scrollEventThrottle: number;
  /** The header's full height (collapsible + pinned part). */
  readonly topInset: number;
  /**
   * The list's content-container style: `paddingTop` = the header height, so the first row starts right under the header, and - when the
   * list has rows - a minimum height of viewport + collapsible height, so a short list can still be scrolled far enough to collapse the
   * header completely instead of stopping half-collapsed at its end. An empty / loading list keeps its own natural height.
   */
  readonly contentInset: (hasRows: boolean) => { readonly paddingTop: number; readonly minHeight?: number };
  /** Pass to the list's `ref` - lets the header scroll the list back to the top. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the list's row type belongs to the screen
  readonly listRef: RefObject<FlatList<any> | null>;
  /** Android pull-to-refresh: put the spinner below the header. iOS ignores it. */
  readonly withRefreshOffset: (control: ReactElement) => ReactElement;
}

type Part = ReactNode | ((state: HeaderState) => ReactNode);

interface CollapsibleHeaderLayoutProps {
  /** Scrolls away with the content (1:1, no animation of its own). */
  readonly collapsible?: Part;
  /** Stays at the top once the collapsible part is gone. */
  readonly pinned?: Part;
  /** Changing it returns the header to its expanded state (a different tab / list). */
  readonly resetKey?: string | number;
  /** Extra JS-side scroll listener (called with every scroll event). */
  readonly onScrollEvent?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  readonly backgroundColor?: string;
  /**
   * Extra scroll (dp) after the pinned part has docked before `isCollapsed` turns true. For content that is part of the LIST but is still
   * visible just below the pinned part (a row that scrolls away under it): the pinned part may offer its own copy of a control only once the
   * list's copy has gone, so the control is never drawn twice.
   */
  readonly collapsedExtra?: number;
  readonly testID?: string;
  readonly children: (list: CollapsibleListBinding) => ReactNode;
}

const resolve = (part: Part | undefined, state: HeaderState): ReactNode => (typeof part === 'function' ? part(state) : part);
const isPresent = (node: ReactNode): boolean => node !== null && node !== undefined && node !== false;

/**
 * Header = [collapsible part][pinned part], drawn OVER the list. The list reserves the header's full height as top padding, and the header
 * is translated up by exactly the list's scroll offset (clamped to the collapsible part's height) - so it moves 1:1 with the content, like
 * part of it, until only the pinned part is left at the top. The translation runs on the native thread (Animated.event + native driver),
 * so there is no JS-driven animation, no jump and no lag; scrolling back to the top restores the whole header.
 *
 * Nothing is shown collapsed-by-animation: the header never hides or reappears on its own, it only follows the scroll position. The
 * list stays a plain virtualized FlatList (no nested ScrollView). Measured heights come from onLayout, so long translations and larger
 * system fonts are handled; the list stays invisible for the very first layout pass so it never flashes at the wrong offset.
 */
export function CollapsibleHeaderLayout({ collapsible, pinned, resetKey, onScrollEvent, backgroundColor = colors.background, collapsedExtra = 0, testID, children }: CollapsibleHeaderLayoutProps) {
  const scrollY = useRef(new Animated.Value(0)).current;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the list's row type belongs to the screen
  const listRef = useRef<FlatList<any> | null>(null);
  const [collapsibleHeight, setCollapsibleHeight] = useState<number | null>(null);
  const [pinnedHeight, setPinnedHeight] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  const scrollToTop = useCallback(() => listRef.current?.scrollToOffset({ animated: true, offset: 0 }), []);

  // What the header parts may read: the last measured collapsible height (0 until measured).
  const state: HeaderState = { isCollapsed, scrollToTop };
  const collapsibleNode = resolve(collapsible, state);
  const pinnedNode = resolve(pinned, state);
  const hasCollapsible = isPresent(collapsibleNode);
  const hasPinned = isPresent(pinnedNode);
  const distance = hasCollapsible ? collapsibleHeight : 0;
  const pinnedSize = hasPinned ? pinnedHeight : 0;
  const measured = distance !== null && pinnedSize !== null;
  const collapseDistance = distance ?? 0;
  const topInset = collapseDistance + (pinnedSize ?? 0);

  const distanceRef = useRef(collapseDistance + collapsedExtra);
  distanceRef.current = collapseDistance + collapsedExtra;
  const listenerRef = useRef(onScrollEvent);
  listenerRef.current = onScrollEvent;

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const limit = distanceRef.current;
        const next = limit > 0 && event.nativeEvent.contentOffset.y >= limit - 1;
        if (next !== collapsedRef.current) {
          collapsedRef.current = next;
          setIsCollapsed(next);
        }
        listenerRef.current?.(event);
      },
    }),
    [scrollY],
  );

  useEffect(() => {
    scrollY.setValue(0);
    collapsedRef.current = false;
    setIsCollapsed(false);
  }, [resetKey, scrollY]);

  const translateY = useMemo(
    () => (collapseDistance > 0 ? scrollY.interpolate({ inputRange: [0, collapseDistance], outputRange: [0, -collapseDistance], extrapolate: 'clamp' }) : 0),
    [collapseDistance, scrollY],
  );

  const onCollapsibleLayout = useCallback((event: LayoutChangeEvent) => setCollapsibleHeight(Math.round(event.nativeEvent.layout.height)), []);
  const onPinnedLayout = useCallback((event: LayoutChangeEvent) => setPinnedHeight(Math.round(event.nativeEvent.layout.height)), []);
  const withRefreshOffset = useCallback((control: ReactElement) => cloneElement(control, { progressViewOffset: topInset } as Record<string, unknown>), [topInset]);

  const contentInset = useCallback(
    (hasRows: boolean) => ({ minHeight: hasRows && viewportHeight > 0 && collapseDistance > 0 ? viewportHeight + collapseDistance + collapsedExtra : undefined, paddingTop: topInset }),
    [collapseDistance, collapsedExtra, topInset, viewportHeight],
  );
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => setViewportHeight(Math.round(event.nativeEvent.layout.height)), []);

  const binding: CollapsibleListBinding = {
    contentInset,
    isCollapsed,
    scrollToTop,
    listRef,
    onScroll,
    scrollEventThrottle: 16,
    topInset,
    withRefreshOffset,
  };

  return (
    <View style={styles.root}>
      <View onLayout={onViewportLayout} style={[styles.list, !measured && styles.unmeasured]}>{children(binding)}</View>
      <Animated.View style={[styles.header, { backgroundColor, transform: [{ translateY }] }]} testID={testID}>
        {hasCollapsible ? <View onLayout={onCollapsibleLayout}>{collapsibleNode}</View> : null}
        {hasPinned ? <View onLayout={onPinnedLayout}>{pinnedNode}</View> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clips what has scrolled up past the top edge: the collapsed part of the header must not stay visible under the status bar.
  root: { flex: 1, overflow: 'hidden' },
  list: { flex: 1 },
  unmeasured: { opacity: 0 },
  header: { left: 0, position: 'absolute', right: 0, top: 0, zIndex: 2 },
});
