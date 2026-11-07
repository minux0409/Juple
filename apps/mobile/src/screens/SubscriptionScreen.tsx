import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { useAuth } from '../auth/AuthContext';
import { DataRetentionCard } from '../billing/DataRetentionCard';
import { useSubscriptionStore } from '../billing/useSubscriptionStore';
import type { SubscriptionPlan } from '../billing/subscriptionStore';
import { computeAnnualSavings, discountBadgePercent, formatMoney, yearlyPerMonthAmount, type PlanKey } from '../billing/subscriptionPricing';
import { describeSubscription, isSubscribedView } from '../billing/subscriptionStatus';
import type { OfferUnavailableReason, PurchaseResult, RestoreResult } from '../billing/types';
import { GradientPill } from '../components/GradientPill';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useMessageDialog } from '../components/useMessageDialog';
import { legalLinks } from '../config/legalLinks';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

type PlansState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly plans: readonly SubscriptionPlan[] }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

/**
 * Membership: the two plans (monthly and yearly of the ONE Juple membership) with the prices exactly as the store reports them for this
 * storefront, the account's ONE subscription status (with only the dates the Backend actually has), Subscribe or Manage, and Restore
 * purchases. Store-neutral: it talks only to useSubscriptionStore (Google Play on Android, the App Store on iOS) and never decides
 * anything - a purchase or restore resolves only after the Backend verified it, and the status shown is what the Backend reported.
 *
 * Nothing about price is hardcoded: with no store price there is no price and no Subscribe, only a retry. The yearly "about N% off" badge and
 * the saved amount are computed from THIS storefront's monthly x 12 against its own yearly price - so they are never claimed where the
 * numbers do not show a real saving. Whether Juple currently requires a subscription is deliberately not shown here.
 */
export function SubscriptionScreen() {
  const { t, i18n } = useTranslation();
  const store = useSubscriptionStore();
  const { entitlement, storeSubscription } = useAuth();
  const { showMessage, messageDialog } = useMessageDialog();
  const [plansState, setPlansState] = useState<PlansState>({ kind: 'loading' });
  const [selected, setSelected] = useState<PlanKey | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadPlans = useCallback(async () => {
    setPlansState({ kind: 'loading' });
    const result = await store.loadPlans();
    if (!isMounted.current) {
      return;
    }
    if (result.kind === 'ready') {
      setPlansState({ kind: 'ready', plans: result.plans });
      // The yearly plan is the recommended one: preselected when the store offers it, otherwise whatever it does offer.
      setSelected(previous => (previous && result.plans.some(plan => plan.key === previous) ? previous : (result.plans.find(plan => plan.key === 'yearly') ?? result.plans[0]).key));
    } else {
      setPlansState({ kind: 'unavailable', reason: result.reason });
    }
  }, [store]);

  useEffect(() => {
    loadPlans().catch(() => {
      if (isMounted.current) {
        setPlansState({ kind: 'unavailable', reason: 'storeUnavailable' });
      }
    });
  }, [loadPlans]);

  const unavailableText = useCallback(
    (reason: OfferUnavailableReason) => {
      switch (reason) {
        case 'disabled':
          return t('subscription.unavailable.disabled');
        case 'unsupportedPlatform':
          return t('subscription.unavailable.platform');
        case 'productNotFound':
        case 'offerNotFound':
          return t('subscription.unavailable.product');
        default:
          return t('subscription.unavailable.store');
      }
    },
    [t],
  );

  const purchaseText = useCallback(
    (result: PurchaseResult): string | null => {
      switch (result.kind) {
        case 'verified':
          return t('subscription.result.verified');
        case 'pending':
          return t('subscription.result.pending');
        case 'notEntitled':
          return t('subscription.result.notEntitled');
        case 'alreadyOwned':
          return t('subscription.result.alreadyOwned');
        case 'verificationFailed':
          if (result.reason === 'belongsToAnotherAccount') {
            return t('subscription.result.anotherAccount');
          }
          return result.reason === 'rejected' ? t('subscription.result.failed') : t('subscription.result.temporary');
        case 'unavailable':
          return unavailableText(result.reason);
        case 'error':
          return t('subscription.result.failed');
        case 'cancelled':
          // The person closed the store sheet: not an error, nothing to say.
          return null;
      }
    },
    [t, unavailableText],
  );

  const restoreText = useCallback(
    (result: RestoreResult): string => {
      switch (result.kind) {
        case 'restored':
          return t('subscription.restoreResult.restored');
        case 'nothingFound':
          return t('subscription.restoreResult.nothingFound');
        case 'belongsToAnotherJupleAccount':
          return t('subscription.restoreResult.anotherAccount');
        case 'unavailable':
          return unavailableText(result.reason);
        default:
          return t('subscription.restoreResult.temporary');
      }
    },
    [t, unavailableText],
  );

  const runExclusive = useCallback(
    async (work: () => Promise<string | null>) => {
      if (isBusy) {
        return;
      }
      setIsBusy(true);
      try {
        const message = await work();
        if (message && isMounted.current) {
          showMessage(message);
        }
      } catch {
        if (isMounted.current) {
          showMessage(t('subscription.result.failed'));
        }
      } finally {
        if (isMounted.current) {
          setIsBusy(false);
        }
      }
    },
    [isBusy, showMessage, t],
  );

  const subscribe = () => runExclusive(async () => purchaseText(await store.purchase(selected ?? 'monthly')));
  const restore = () => runExclusive(async () => restoreText(await store.restore()));

  const manage = () => runExclusive(async () => {
    try {
      await store.openSubscriptionManagement();
      return null;
    } catch {
      return t('subscription.manageFailed');
    }
  });

  // The ONE subscription status: what the Backend reported about the store subscription (and Juple's own free period). No date is
  // computed here, and whether Juple currently REQUIRES a subscription is never shown - that is an operations switch, not a person's concern.
  const view = describeSubscription(storeSubscription ?? null, entitlement ?? null);
  const formatDate = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso)) : null);
  const plans = plansState.kind === 'ready' ? plansState.plans : [];
  const monthly = plans.find(plan => plan.key === 'monthly') ?? null;
  const yearly = plans.find(plan => plan.key === 'yearly') ?? null;
  const chosen = plans.find(plan => plan.key === selected) ?? null;
  const isReady = plansState.kind === 'ready' && chosen !== null;

  const savings = useMemo(
    () => computeAnnualSavings(
      monthly ? { key: 'monthly', priceAmount: monthly.priceAmount, currencyCode: monthly.currencyCode } : null,
      yearly ? { key: 'yearly', priceAmount: yearly.priceAmount, currencyCode: yearly.currencyCode } : null,
    ),
    [monthly, yearly],
  );
  const badgePercent = discountBadgePercent(savings);
  const perMonthAmount = yearly ? yearlyPerMonthAmount({ key: 'yearly', priceAmount: yearly.priceAmount, currencyCode: yearly.currencyCode }) : null;

  // The amount of the next charge is shown only alongside a date it is charged on, and is the store's current price for the chosen plan.
  const offerPrice = chosen?.localizedPrice ?? monthly?.localizedPrice ?? null;

  // Rows are only the facts the Backend actually has; a missing value is a missing row, never an estimate.
  const rows: { readonly id: string; readonly label: string; readonly value: string }[] = [];
  const addRow = (id: string, labelKey: string, value: string | null) => {
    if (value) {
      rows.push({ id, label: t(labelKey), value });
    }
  };
  let note: string | null = null;
  switch (view.kind) {
    case 'active':
      addRow('startedOn', 'subscription.row.startedOn', formatDate(view.startedAtUtc));
      addRow('nextPaymentOn', 'subscription.row.nextPaymentOn', formatDate(view.nextPaymentAtUtc));
      addRow('nextPaymentAmount', 'subscription.row.nextPaymentAmount', view.nextPaymentAtUtc ? offerPrice : null);
      break;
    case 'gracePeriod':
      addRow('startedOn', 'subscription.row.startedOn', formatDate(view.startedAtUtc));
      note = t('subscription.detail.grace');
      break;
    case 'canceled':
      addRow('startedOn', 'subscription.row.startedOn', formatDate(view.startedAtUtc));
      addRow('accessEndsOn', 'subscription.row.accessEndsOn', formatDate(view.accessEndsAtUtc));
      note = t('subscription.note.canceled');
      break;
    case 'expired':
    case 'revoked':
      addRow('endedOn', 'subscription.row.endedOn', formatDate(view.endedAtUtc));
      break;
    case 'trial':
      addRow('trialEndsOn', 'subscription.row.trialEndsOn', formatDate(view.endsAtUtc));
      note = t('subscription.note.trial');
      break;
    default:
      break;
  }
  const isSubscribed = isSubscribedView(view);
  const showManage = isSubscribed && store.canManageSubscription;

  const planName = (key: PlanKey) => t(key === 'yearly' ? 'subscription.plan.yearlyName' : 'subscription.plan.monthlyName');
  const planPrice = (plan: SubscriptionPlan) => t(plan.key === 'yearly' ? 'subscription.plan.perYear' : 'subscription.plan.perMonth', { price: plan.localizedPrice });
  const renewText = (key: PlanKey) => t(key === 'yearly' ? 'subscription.plan.yearlyRenew' : 'subscription.plan.monthlyRenew');
  const cancelHow = Platform.OS === 'ios' ? t('subscription.billing.cancelHowIos') : t('subscription.billing.cancelHowAndroid');

  const renderPlan = (plan: SubscriptionPlan) => {
    const isSelected = selected === plan.key;
    const isYearly = plan.key === 'yearly';
    const locale = i18n.language;
    return (
      <Pressable
        accessibilityLabel={`${planName(plan.key)}, ${planPrice(plan)}, ${renewText(plan.key)}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected, disabled: isBusy }}
        disabled={isBusy}
        key={plan.key}
        onPress={() => setSelected(plan.key)}
        style={[styles.planCard, isSelected && styles.planCardSelected]}
        testID={`subscription-plan-${plan.key}`}
      >
        <View style={styles.planHeader}>
          <View style={[styles.radio, isSelected && styles.radioSelected]}>{isSelected ? <View style={styles.radioDot} /> : null}</View>
          <Text numberOfLines={2} style={styles.planTitle}>{planName(plan.key)}</Text>
          {isYearly ? <GradientPill label={t('subscription.plan.recommended')} testID="subscription-recommended" /> : null}
        </View>
        <Text style={styles.planPrice} testID={`subscription-price-${plan.key}`}>{planPrice(plan)}</Text>
        <Text style={styles.planNote}>{renewText(plan.key)}</Text>
        {isYearly && badgePercent !== null ? (
          <View style={styles.savingRow}>
            <Text style={styles.discountText} testID="subscription-discount-badge">{t('subscription.plan.discountBadge', { percent: badgePercent })}</Text>
            {savings ? <Text style={styles.planNote} testID="subscription-savings">{t('subscription.plan.saveAmount', { amount: formatMoney(savings.amount, savings.currencyCode, locale) })}</Text> : null}
          </View>
        ) : null}
        {isYearly && perMonthAmount !== null && yearly?.currencyCode ? (
          <Text style={styles.planNote} testID="subscription-per-month">{t('subscription.plan.perMonthEquivalent', { price: formatMoney(perMonthAmount, yearly.currencyCode, locale) })}</Text>
        ) : null}
      </Pressable>
    );
  };

  const openLegal = (url: string | null) => {
    if (url) {
      Linking.openURL(url).catch(() => undefined);
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heroTitle}>{t('subscription.planName')}</Text>

        {plansState.kind === 'unavailable' ? (
          <LoadFailureState
            error={plansState.reason === 'storeUnavailable' ? new Error('store') : undefined}
            notice={plansState.reason === 'storeUnavailable' ? null : unavailableText(plansState.reason)}
            onRetry={() => { loadPlans().catch(() => undefined); }}
            testID="subscription-unavailable"
          />
        ) : plansState.kind === 'loading' ? (
          <View style={styles.card}>
            <ActivityIndicator accessibilityLabel={t('subscription.loading')} color={colors.textSecondary} style={styles.loader} testID="subscription-loading" />
          </View>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.planGroup} testID="subscription-plans">
            {yearly ? renderPlan(yearly) : null}
            {monthly ? renderPlan(monthly) : null}
          </View>
        )}

        {isSubscribed ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isReady || isBusy, busy: isBusy }}
              disabled={!isReady || isBusy}
              onPress={() => { subscribe().catch(() => undefined); }}
              style={[styles.primaryButton, (!isReady || isBusy) && styles.disabledButton]}
              testID="subscription-subscribe"
            >
              {isBusy ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryLabel}>{t(selected === 'yearly' ? 'subscription.subscribeYearly' : 'subscription.subscribeMonthly')}</Text>}
            </Pressable>
            {chosen ? (
              <Text style={styles.billingText} testID="subscription-billing-summary">
                {t(chosen.key === 'yearly' ? 'subscription.billing.summaryYearly' : 'subscription.billing.summaryMonthly', { price: chosen.localizedPrice })}
              </Text>
            ) : null}
            <Text style={styles.billingText} testID="subscription-free-notice">{t('subscription.billing.freeNotice')}</Text>
            <Text style={styles.billingText} testID="subscription-cancel-how">{cancelHow}</Text>
          </>
        )}

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('subscription.stateHeading')}</Text>
        <View style={[styles.card, styles.accessCard]} testID="subscription-status-card">
          <Text style={styles.accessLabel} testID="subscription-status">{t(`subscription.status.${view.kind}`)}</Text>
          {rows.map(row => (
            <View key={row.id} style={styles.row} testID={`subscription-row-${row.id}`}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue} testID={`subscription-row-${row.id}-value`}>{row.value}</Text>
            </View>
          ))}
          {note ? <Text style={styles.accessDetail} testID="subscription-status-note">{note}</Text> : null}
        </View>

        <DataRetentionCard />

        {showManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            disabled={isBusy}
            onPress={() => { manage().catch(() => undefined); }}
            style={[styles.primaryButton, isBusy && styles.disabledButton]}
            testID="subscription-manage"
          >
            <Text style={styles.primaryLabel}>{t('subscription.manage')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          onPress={() => { restore().catch(() => undefined); }}
          style={[styles.secondaryButton, isBusy && styles.disabledButton]}
          testID="subscription-restore"
        >
          <Text style={styles.secondaryLabel}>{t('subscription.restore')}</Text>
        </Pressable>

        <View style={styles.legalRow} testID="subscription-legal">
          {legalLinks.termsUrl ? (
            <Pressable accessibilityRole="link" onPress={() => openLegal(legalLinks.termsUrl)} style={styles.legalLink} testID="subscription-terms">
              <Text style={styles.legalLabel}>{t('customerCenter.terms')}</Text>
            </Pressable>
          ) : null}
          {legalLinks.privacyUrl ? (
            <Pressable accessibilityRole="link" onPress={() => openLegal(legalLinks.privacyUrl)} style={styles.legalLink} testID="subscription-privacy">
              <Text style={styles.legalLabel}>{t('customerCenter.privacy')}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('subscription.infoHeading')}</Text>
        <View style={[styles.card, styles.infoCard]} testID="subscription-info">
          {(['account', 'store', 'data'] as const).map((row, index) => (
            <View key={row} style={[styles.infoRow, index > 0 && styles.infoRowDivider]}>
              <Text style={styles.infoTitle}>{t(`subscription.info.${row}Title`)}</Text>
              <Text style={styles.infoBody}>{t(`subscription.info.${row}Body`)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {messageDialog}
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  heroTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, ...cardShadow },
  accessCard: { paddingVertical: spacing.md },
  planGroup: { gap: spacing.md },
  planCard: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: 1.5, padding: spacing.lg },
  planCardSelected: { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 2 },
  planHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  planTitle: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
  radio: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: 11, borderWidth: 2, height: 22, justifyContent: 'center', width: 22 },
  radioSelected: { borderColor: colors.brand },
  radioDot: { backgroundColor: colors.brand, borderRadius: 6, height: 12, width: 12 },
  planPrice: { color: colors.textPrimary, flexShrink: 1, fontSize: 24, fontWeight: '800', marginTop: spacing.sm },
  planNote: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, lineHeight: 19, marginTop: 2 },
  savingRow: { alignItems: 'baseline', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  discountText: { color: colors.brandText, fontSize: 14, fontWeight: '800' },
  loader: { alignSelf: 'flex-start' },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.xl },
  accessLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  accessDetail: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.sm },
  rowLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, lineHeight: 20 },
  rowValue: { color: colors.textPrimary, flexShrink: 1, fontSize: 14, fontWeight: '600', lineHeight: 20, textAlign: 'right' },
  infoCard: { paddingVertical: spacing.xs },
  infoRow: { paddingVertical: spacing.md },
  infoRowDivider: { borderTopColor: colors.inputBorder, borderTopWidth: StyleSheet.hairlineWidth },
  infoTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  infoBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  billingText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.sm, textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.lg, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  primaryLabel: { color: colors.onBrand, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.brandText, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  legalRow: { columnGap: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  legalLink: { justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.xs },
  legalLabel: { color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' },
  disabledButton: { opacity: 0.5 },
}));
