import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, minTouchTarget, themedStyles } from '../theme/tokens';

/**
 * Pull-to-refresh with its own loading row (Instagram-style), the same on iOS and Android: the native control only takes the pull
 * gesture. As soon as the person's pull has started the refresh, the native spinner is put away - it is driven true, then false
 * on the next render, the one sequence both platforms reliably end on - and `refreshRow` is a row of its own, with the spinner
 * centred in it, that the screen puts at the very top of its list content. It never floats over the screen's title or names (the
 * native spinner could stay on screen over them when the list's offset was reset while it spun), takes room only while the pulled
 * refresh runs and then simply goes. A refresh the screen starts by itself (on focus) shows nothing - the data stays as it is - and a
 * first load keeps its skeletons. `refreshing` is the screen's real "a refresh request is running" state.
 */
export function usePullToRefresh(refreshing: boolean, onRefresh: () => void): { readonly refreshControl: ReactElement; readonly refreshRow: ReactElement | null } {
  const [pulled, setPulled] = useState(false);
  const [handedOff, setHandedOff] = useState(false);

  useEffect(() => {
    if (!refreshing) {
      setPulled(false);
      setHandedOff(false);
    }
  }, [refreshing]);

  const nativeRefreshing = refreshing && pulled && !handedOff;
  useEffect(() => {
    if (nativeRefreshing) {
      setHandedOff(true);
    }
  }, [nativeRefreshing]);

  const handleRefresh = useCallback(() => {
    setPulled(true);
    setHandedOff(false);
    onRefresh();
  }, [onRefresh]);

  return {
    refreshControl: <RefreshControl onRefresh={handleRefresh} refreshing={nativeRefreshing} />,
    refreshRow: refreshing && pulled ? <PullRefreshRow /> : null,
  };
}

/** The loading row: a fixed-height line of its own with the spinner in its centre. */
export function PullRefreshRow() {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('common.refreshing')} accessibilityRole="progressbar" style={styles.row} testID="pull-refresh-row">
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center' },
}));
