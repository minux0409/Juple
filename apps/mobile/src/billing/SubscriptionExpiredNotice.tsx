import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useOptionalAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * A quiet notice at the top of Home and Collections for an account whose free period ended with no subscription: saved links
 * and Collections stay readable, a subscription brings saving and editing back. Shown only when the server says the program is
 * launched AND the account is expired - while the program is off (`status` null) nothing is ever shown. Presentation only: the
 * backend refuses the writes.
 */
export function SubscriptionExpiredNotice() {
  const { t } = useTranslation();
  const entitlement = useOptionalAuth()?.entitlement;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  if (!entitlement?.programEnabled || entitlement.status !== 'expired') {
    return null;
  }

  return (
    <View style={styles.notice} testID="subscription-expired-notice">
      <Text accessibilityRole="header" style={styles.title}>{t('subscription.access.expired')}</Text>
      <Text style={styles.body}>{t('subscription.detail.expired')}</Text>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Subscription')} style={styles.button} testID="subscription-expired-notice-cta">
        <Text numberOfLines={2} style={styles.buttonLabel}>{t('subscription.subscribe')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: colors.brandSoft, borderRadius: radii.lg, marginBottom: spacing.md, padding: spacing.md, rowGap: spacing.xs },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  button: { alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', marginTop: spacing.xs, minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  buttonLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
