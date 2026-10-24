import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { BellIcon } from '../icons/BellIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('notices.title')}${
        unread ? `, ${t('notices.unread')}` : ''
      }`}
      testID="my-notices"
      onPress={() => navigation.navigate('Notices')}
      style={styles.row}
    >
      <BellIcon color={colors.textSecondary} size={18} />
      <View style={styles.text}>
        <Text style={styles.title}>{t('notices.title')}</Text>
        <Text style={styles.description}>{t('notices.description')}</Text>
      </View>
      {unread ? (
        <View style={styles.badge} testID="notice-new-badge">
          <Text style={styles.badgeText}>N</Text>
        </View>
      ) : null}
      <ChevronIcon color={colors.textSecondary} size={18} direction="right" />
    </Pressable>
  );
}
const styles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    minHeight: minTouchTarget,
  },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, color: colors.textPrimary },
  description: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  badge: {
    backgroundColor: colors.brand,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.onBrand },
}));
