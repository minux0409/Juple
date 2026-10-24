import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Text, View } from 'react-native';
import { SettingsMenuRow } from '../components/SettingsMenuRow';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { BellIcon } from '../icons/BellIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, themedStyles } from '../theme/tokens';
import { noticeGet, noticePlatform, subscribeNoticeReads } from './noticesApi';

export function NoticeMenuRow() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [unread, setUnread] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      let generation = 0;
      const refresh = () => {
        if (AppState.currentState !== 'active') return;
        const own = ++generation;
        noticeGet<{ hasUnread: boolean }>(
          request,
          `/api/v1/notices/unread?platform=${noticePlatform()}`,
        ).then(
          value => {
            if (active && own === generation) setUnread(value.hasUnread);
          },
          () => undefined,
        );
      };
      refresh();
      const timer = setInterval(refresh, 60000);
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') refresh();
      });
      const unsubscribe = subscribeNoticeReads(refresh);
      return () => {
        active = false;
        clearInterval(timer);
        sub.remove();
        unsubscribe();
      };
    }, [request]),
  );
  return (
    <SettingsMenuRow
      accessibilityLabel={`${t('notices.title')}${
        unread ? `, ${t('notices.unread')}` : ''
      }`}
      testID="my-notices"
      onPress={() => navigation.navigate('Notices')}
      icon={<BellIcon color={colors.textSecondary} size={18} />}
      title={t('notices.title')}
      badge={
        unread ? (
          <View style={styles.badge} testID="notice-new-badge">
            <Text style={styles.badgeText}>N</Text>
          </View>
        ) : null
      }
    />
  );
}
const styles = themedStyles(() => ({
  badge: {
    marginStart: 8,
    backgroundColor: colors.brand,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.onBrand },
}));
