import { useCallback, useEffect, useRef, useState } from 'react';

/** How close to the end (in viewports) a list asks for more - also how much loaded content a continuous feed keeps beyond the viewport. */
export const END_REACHED_THRESHOLD = 0.5;

interface UseContinuousViewportFillOptions {
  /** Whether this feed should fill itself (a continuous feed on screen, no search replacing it). */
  readonly enabled: boolean;
  /**
   * Requests the next unit of data (a page, or the next section's first page) - one request at a time: it must itself
   * refuse while one is loading and after a failure, so the retry row (not this hook) resumes a failed chain.
   */
  readonly advance: () => void;
  /** Changes whenever the loaded data / loading state changes: every request's outcome re-runs the check. */
  readonly dataKey: unknown;
}

/**
 * A continuous (전체) feed must not depend on the user scrolling. React Native sends onEndReached once per distinct
 * content LENGTH, and an advance that is a no-op while a request is loading uses that one shot up - so when the page
 * lands and the content comes out the SAME length (an Image-view skeleton line is exactly as tall as the tile line
 * that replaces it), nothing ever asks again and the feed stops short. This hook measures the list and, while the
 * loaded links do not fill the viewport (plus the end-reached margin, so scrolling takes over), keeps calling
 * `advance` - one request at a time, because each outcome changes `dataKey` and re-runs the check. It reads data
 * state through `advance`, never row counts, so List, Grid and Image all converge on the same sequence.
 *
 * Nothing is decided until both sizes are really known (an unmeasured list is not an empty one).
 * The returned handlers go on the FlatList (onLayout / onContentSizeChange).
 */
export function useContinuousViewportFill({ enabled, advance, dataKey }: UseContinuousViewportFillOptions) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (!enabled || viewportHeight <= 0 || contentHeight <= 0) {
      return;
    }
    if (contentHeight >= viewportHeight * (1 + END_REACHED_THRESHOLD)) {
      return;
    }
    advanceRef.current();
  }, [contentHeight, dataKey, enabled, viewportHeight]);

  const onLayout = useCallback((event: { nativeEvent: { layout: { height: number } } }) => setViewportHeight(event.nativeEvent.layout.height), []);
  const onContentSizeChange = useCallback((_width: number, height: number) => setContentHeight(height), []);
  return { onLayout, onContentSizeChange };
}
