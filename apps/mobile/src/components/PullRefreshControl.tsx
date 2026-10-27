import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Platform, RefreshControl } from 'react-native';
import { colors } from '../theme/tokens';

/**
 * Pull-to-refresh with ONE spinner: the platform's own (UIRefreshControl on iOS, SwipeRefreshLayout on Android). There is no second,
 * custom loading row - the native control alone shows the pulled refresh, from the pull until the request has finished, and then
 * returns to its place. `refreshing` is the screen's real "a refresh request is running" state.
 *
 * - Only a refresh the person started by pulling is shown. A refresh the screen starts by itself (on focus, after a change) shows
 *   nothing - the data stays as it is. On iOS that is also what keeps the spinner from getting stuck: driving UIRefreshControl from
 *   code makes React Native shift the scroll offset and call beginRefreshing, and when that happened during a navigation transition,
 *   endRefreshing could leave the spinner on screen for good.
 * - The spinner shows exactly while the pull and the request overlap: the screens set their refreshing state in the same update as
 *   the pull, and the pull is forgotten the moment no request is running - so a finished refresh can never bring a spinner back, and
 *   a pull whose request did not start (nothing to do) simply springs back.
 * - A pull while a refresh is already running joins it: the spinner follows that request, no second request is started.
 * - Look: Android draws its spinner on a small round disc of its own - given the raised surface colour of the current theme, so it
 *   reads as a light or dark chip above the content. iOS has no such disc (UIRefreshControl has no background of its own); its
 *   spinner sits in the space the pull opens above the content, tinted with the theme's secondary text colour.
 */
export function usePullToRefresh(refreshing: boolean, onRefresh: () => void): { readonly refreshControl: ReactElement } {
  const [pulled, setPulled] = useState(false);

  useEffect(() => {
    if (pulled && !refreshing) {
      setPulled(false);
    }
  }, [pulled, refreshing]);

  const handleRefresh = useCallback(() => {
    setPulled(true);
    if (!refreshing) {
      onRefresh();
    }
  }, [onRefresh, refreshing]);

  const shown = pulled && refreshing;
  return {
    refreshControl:
      Platform.OS === 'android' ? (
        <RefreshControl colors={[colors.brand]} onRefresh={handleRefresh} progressBackgroundColor={colors.surfaceRaised} refreshing={shown} />
      ) : (
        <RefreshControl onRefresh={handleRefresh} refreshing={shown} tintColor={colors.textSecondary} />
      ),
  };
}
