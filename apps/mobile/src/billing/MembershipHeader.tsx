import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { GradientPill } from '../components/GradientPill';
import { ProgressBar } from '../components/ProgressBar';
import { cardShadow, colors, radii, spacing, themedStyles } from '../theme/tokens';
import type { MembershipBadge, TrialProgress } from './membershipModel';

/** "Juple Membership", its line, and the one status badge (when there is a status to show). */
export function MembershipHeader({ badge }: { readonly badge: MembershipBadge | null }) {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heroTitle}>{t('membership.heroTitle')}</Text>
      <Text style={styles.heroSubtitle}>{t('membership.heroSubtitle')}</Text>
      {badge ? (
        <View style={[styles.badge, badge === 'member' || badge === 'trial' ? styles.badgeLive : badge === 'pending' ? styles.badgePending : styles.badgeEnded]} testID={`membership-badge-${badge}`}>
          <Text numberOfLines={2} style={[styles.badgeLabel, badge === 'member' || badge === 'trial' ? styles.badgeLabelLive : styles.badgeLabelQuiet]}>{t(`membership.badge.${badge}`)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The running free month: how many days are left (with a D-n badge), how much has passed, and the server's end date. Every number comes
 * from describeTrialProgress (server values only).
 */
export function TrialPeriodCard({ trial }: { readonly trial: TrialProgress }) {
  const { t, i18n } = useTranslation();
  const endsOn = new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(trial.endsAtUtc));
  const percent = Math.round(trial.elapsed * 100);
  return (
    <View style={styles.trialCard} testID="membership-trial-card">
      <View style={styles.trialTitleRow}>
        <Text style={styles.trialTitle}>{t('membership.trialCard.title')}</Text>
        <GradientPill label={t('membership.trialCard.dDay', { count: trial.daysLeft })} testID="membership-trial-dday" />
      </View>
      <Text style={styles.trialDays} testID="membership-trial-days">
        {trial.daysLeft > 1 ? t('membership.trialCard.daysLeft', { count: trial.daysLeft }) : t('membership.trialCard.lastDay')}
      </Text>
      <View
        accessibilityLabel={t('membership.trialCard.progressA11y', { percent })}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        accessible
        style={styles.progress}
        testID="membership-trial-progress"
      >
        <ProgressBar progress={trial.elapsed} />
      </View>
      <Text style={styles.trialEnds} testID="membership-trial-ends">{t('membership.trialCard.endsOn', { date: endsOn })}</Text>
      <Text style={styles.trialBody}>{t('membership.trialCard.body')}</Text>
    </View>
  );
}

/** "지금은 결제하지 않아도 괜찮아요" - while the free month runs, above the plans. */
export function NoPaymentNeededNote() {
  const { t } = useTranslation();
  return (
    <View style={styles.note} testID="membership-no-payment-needed">
      <Text style={styles.noteTitle}>{t('membership.noPaymentNeeded.title')}</Text>
      <Text style={styles.noteBody}>{t('membership.noPaymentNeeded.body')}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  header: { marginBottom: spacing.lg },
  heroTitle: { color: colors.textPrimary, fontSize: 24, fontWeight: '800' },
  heroSubtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 21, marginTop: spacing.xs },
  badge: { alignSelf: 'flex-start', borderRadius: 999, marginTop: spacing.md, maxWidth: '100%', paddingHorizontal: spacing.md, paddingVertical: 5 },
  badgeLive: { backgroundColor: colors.brandSoft },
  badgePending: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderWidth: 1 },
  badgeEnded: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderWidth: 1 },
  badgeLabel: { fontSize: 13, fontWeight: '700' },
  badgeLabelLive: { color: colors.brandText },
  badgeLabelQuiet: { color: colors.textSecondary },
  trialCard: { backgroundColor: colors.surface, borderRadius: radii.lg, marginBottom: spacing.lg, padding: spacing.lg, ...cardShadow },
  trialTitleRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.xs },
  trialTitle: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '700' },
  trialDays: { color: colors.brandText, fontSize: 26, fontWeight: '800', marginTop: spacing.sm },
  progress: { marginTop: spacing.md },
  trialEnds: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: spacing.md },
  trialBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  note: { backgroundColor: colors.brandSoft, borderRadius: radii.lg, marginBottom: spacing.lg, padding: spacing.lg },
  noteTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  noteBody: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
}));
