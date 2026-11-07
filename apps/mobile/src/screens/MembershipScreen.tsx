import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { describeSubscription } from '../billing/subscriptionStatus';
import { useSubscriptionEntryState } from '../billing/useSubscriptionEntry';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';
import { SubscriptionScreen } from './SubscriptionScreen';

/**
 * 멤버십: the one place a person sees their membership. Where a subscription can really be started or managed (Android with the store
 * catalog, while the paid program is live) it IS the subscription screen - price from the store, 구독하기 / 구독 관리 / 구매 복원. Everywhere
 * else (iOS until its store purchase exists, a store that is not configured) it is a read-only status page: the one status the Backend
 * reported, that the status follows the Juple account across Android, iOS and the web, and that saved data is not deleted. It states no price,
 * no term and no end date that the Backend did not send, and it never offers a purchase the app cannot complete. The route itself exists only
 * while the Backend says the program is live (navigation/RootStack), so before activation nobody reaches it.
 */
export function MembershipScreen() {
  const entry = useSubscriptionEntryState();
  if (entry === 'available') {
    return <SubscriptionScreen />;
  }
  if (entry === 'loading') {
    return (
      <StackScreenSafeArea style={styles.safeArea}>
        <View style={styles.center}><ActivityIndicator testID="membership-loading" /></View>
      </StackScreenSafeArea>
    );
  }
  return <MembershipStatus />;
}

function MembershipStatus() {
  const { t, i18n } = useTranslation();
  const { entitlement, storeSubscription } = useAuth();
  const view = describeSubscription(storeSubscription, entitlement);
  const formatDate = (iso: string) => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));

  let status: string | null = null;
  switch (view.kind) {
    case 'trial':
      status = view.endsAtUtc ? t('membership.statusTrial', { date: formatDate(view.endsAtUtc) }) : null;
      break;
    case 'active':
    case 'gracePeriod':
    case 'canceled':
      status = t('membership.statusActive');
      break;
    case 'expired':
    case 'revoked':
      status = t('membership.statusEnded');
      break;
    case 'none':
      status = entitlement?.status === 'expired' ? t('membership.statusEnded') : t('membership.statusNone');
      break;
    default:
      status = null;
  }

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {status ? (
          <View style={styles.card} testID="membership-status">
            <Text style={styles.status}>{status}</Text>
          </View>
        ) : null}
        <Text style={styles.paragraph} testID="membership-cannot-subscribe">{t('membership.cannotSubscribeHere')}</Text>
        <Text style={styles.paragraph}>{t('membership.sharedAccount')}</Text>
        <Text style={styles.paragraph}>{t('membership.dataKept')}</Text>
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  content: { padding: spacing.xl, rowGap: spacing.md },
  card: { backgroundColor: colors.brandSoft, borderRadius: radii.lg, padding: spacing.lg },
  status: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  paragraph: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
}));
