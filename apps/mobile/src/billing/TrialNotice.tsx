import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text, View } from 'react-native';
import { useOptionalAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { describeTrialNotice, dismissTrialNotice, isTrialNoticeDismissed, type TrialNotice as TrialNoticeModel } from './trialNoticeModel';
import { useSubscriptionEntryAvailable } from './useSubscriptionEntry';

/**
 * A quiet card at the top of Home about the free period: once when it starts (what it is and when it ends), and again, at most daily,
 * in its last 7 days. Closed with 닫기; never a modal, never on every launch. The end date is the server's. "구독 보기" appears only
 * where a subscription can actually be started or managed (today: Android with the store catalog); elsewhere it is information only.
 */
export function TrialNotice() {
  const entitlement = useOptionalAuth()?.entitlement;
  // Nothing at all (and no further hook, no request) while the program is off, for a subscriber or an expired account.
  const notice = describeTrialNotice(entitlement, Date.now());
  return notice ? <TrialNoticeCard notice={notice} /> : null;
}

function TrialNoticeCard({ notice }: { readonly notice: TrialNoticeModel }) {
  const { t, i18n } = useTranslation();
  const canOpenSubscription = useSubscriptionEntryAvailable();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Hidden until the stored close mark has been read (never a flash of a card that was already closed).
  const [hidden, setHidden] = useState(true);
  const { kind, endsAtUtc } = notice;

  useEffect(() => {
    let mounted = true;
    isTrialNoticeDismissed({ kind, endsAtUtc }, Date.now()).then(dismissed => {
      if (mounted) {
        setHidden(dismissed);
      }
    });
    return () => {
      mounted = false;
    };
  }, [kind, endsAtUtc]);

  if (hidden) {
    return null;
  }
  const date = new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(endsAtUtc));
  const prefix = kind === 'welcome' ? 'subscription.trialNotice.welcome' : 'subscription.trialNotice.ending';
  return (
    <View style={styles.notice} testID="trial-notice">
      <Text accessibilityRole="header" style={styles.title}>{t(`${prefix}Title`)}</Text>
      <Text style={styles.body}>{t(`${prefix}Body`, { date })}</Text>
      <View style={styles.actions}>
        {canOpenSubscription && Platform.OS === 'android' ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Subscription')} style={styles.primary} testID="trial-notice-view">
            <Text numberOfLines={2} style={styles.primaryLabel}>{t('subscription.trialNotice.view')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setHidden(true);
            void dismissTrialNotice(notice, Date.now());
          }}
          style={styles.secondary}
          testID="trial-notice-dismiss"
        >
          <Text numberOfLines={2} style={styles.secondaryLabel}>{t('common.close')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  notice: { backgroundColor: colors.brandSoft, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.md, rowGap: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  actions: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs, rowGap: spacing.xs },
  primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
}));
