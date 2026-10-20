import { useCallback, useEffect, useState } from 'react';
import { Platform, RefreshControl, type RefreshControlProps } from 'react-native';

/**
 * The list's pull-to-refresh control. `refreshing` is the screen's real "a refresh request is running" state, which a screen also
 * sets for refreshes it starts itself (e.g. on focus, when coming back from a pushed screen).
 *
 * iOS: the native spinner is shown only for a refresh the person started by pulling. Driving UIRefreshControl from code makes React
 * Native shift the scroll offset and call beginRefreshing; when that happens during a navigation transition and the request then
 * finishes, endRefreshing can leave the spinner on screen for good (it stayed at the top of the Collections tab after coming back
 * from a Collection). A background refresh therefore never touches the native control on iOS; the screen's own state still tracks it.
 * Android keeps the platform behavior unchanged (its SwipeRefreshLayout reflects `refreshing` either way).
 */
export function PullRefreshControl({ refreshing, onRefresh, ...rest }: RefreshControlProps) {
  const [pulledByUser, setPulledByUser] = useState(false);

  // The pull ends with the request it started: the next code-started refresh is a background one again.
  useEffect(() => {
    if (!refreshing) {
      setPulledByUser(false);
    }
  }, [refreshing]);

  const handleRefresh = useCallback(() => {
    setPulledByUser(true);
    onRefresh?.();
  }, [onRefresh]);

  const shown = Platform.OS === 'ios' ? refreshing && pulledByUser : refreshing;
  return <RefreshControl {...rest} onRefresh={handleRefresh} refreshing={shown} />;
}
