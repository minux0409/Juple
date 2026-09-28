import { useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

interface NearEndLoadMoreOptions {
  /** A next page exists (the list's hook holds a next cursor). */
  readonly hasMore: boolean;
  /** A page is in flight right now - nothing is re-checked until it lands. */
  readonly isLoadingMore: boolean;
  /** How many entries are loaded - a page landing changes it, which re-checks the position. */
  readonly loadedCount: number;
  /** The list hook's own guarded loadMore - it alone dedupes cursors and drops stale responses. */
  readonly loadMore: () => void;
}

/**
 * Scroll-driven paging for a list whose page can land without making it any taller. onEndReached
 * (about one screen ahead) drives loading while the user scrolls, but it only fires again once the
 * content length changes - and a date-grouped list keeps older dates collapsed, so a page can land
 * entirely inside an already-collapsed section and leave the list exactly as tall as before, or the
 * list may not even fill the screen. So whenever the content size changes or a page finishes, the
 * same "within one screen of the end" check runs again from the last known scroll position. It
 * never loads anything away from the end, and never past the last page.
 *
 * Spread the returned props onto the SectionList/FlatList, next to its own onEndReached={loadMore}
 * and onEndReachedThreshold={1}.
 */
export function useNearEndLoadMore({ hasMore, isLoadingMore, loadedCount, loadMore }: NearEndLoadMoreOptions) {
  const metricsRef = useRef({ offset: 0, contentHeight: 0, viewportHeight: 0 });
  const checkRef = useRef(() => {});
  checkRef.current = () => {
    const { offset, contentHeight, viewportHeight } = metricsRef.current;
    if (hasMore && !isLoadingMore && viewportHeight > 0 && contentHeight - (offset + viewportHeight) < viewportHeight) {
      loadMore();
    }
  };

  useEffect(() => {
    checkRef.current();
  }, [isLoadingMore, loadedCount, hasMore]);

  return {
    onContentSizeChange: (_width: number, height: number) => {
      metricsRef.current.contentHeight = height;
      checkRef.current();
    },
    onLayout: (event: LayoutChangeEvent) => {
      metricsRef.current.viewportHeight = event.nativeEvent.layout.height;
    },
    // Only records the position for the check above - never loads by itself.
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      metricsRef.current.offset = event.nativeEvent.contentOffset.y;
    },
    scrollEventThrottle: 100,
  } as const;
}
