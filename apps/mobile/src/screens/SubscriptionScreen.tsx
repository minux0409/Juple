import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { useAuth } from '../auth/AuthContext';
import { DataRetentionCard } from '../billing/DataRetentionCard';
import { MembershipHeader, NoPaymentNeededNote, TrialPeriodCard } from '../billing/MembershipHeader';
import { describeTrialProgress, membershipBadge, otherStoreHolding } from '../billing/membershipModel';
import { useSubscriptionStore } from '../billing/useSubscriptionStore';
import type { SubscriptionPlan } from '../billing/subscriptionStore';
import { describePaymentSummary } from '../billing/paymentSummary';
import { SelectedPlanFrame } from '../billing/SelectedPlanFrame';
import { computeAnnualSavings, discountBadgePercent, formatMoney, formatPercent, yearlyPerMonthAmount, type PlanKey } from '../billing/subscriptionPricing';
import { describeSubscription, isSubscribedView } from '../billing/subscriptionStatus';
import type { OfferUnavailableReason, PurchaseResult, RestoreResult } from '../billing/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GradientPill } from '../components/GradientPill';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
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
  const complimentaryEnd = entitlement?.complimentaryAccessEndsAtUtc;
  const { showMessage, messageDialog } = useMessageDialog();
  const [plansState, setPlansState] = useState<PlansState>({ kind: 'loading' });
  const [selected, setSelected] = useState<PlanKey | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const busy = useRef(false);
  // A purchase this screen started is still being completed in the store (nothing granted yet): "결제 확인 중" until the server says more.
  const [paymentPending, setPaymentPending] = useState(false);
  // During the free month a purchase asks first: buying now starts billing today and does not add the remaining free days.
  const [isConfirmingTrialPurchase, setIsConfirmingTrialPurchase] = useState(false);
  const isMounted = useRef(true);
  // iOS: the store's purchase sheet waits until the question has finished going away.
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadPlans = useCallback(async () => {
    setPlansState({ kind: 'loading' });
    const result = await store.loadPlans().catch(() => ({ kind: 'unavailable', reason: 'storeUnavailable' } as const));
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
    if (!complimentaryEnd) {
      loadPlans().catch(() => undefined);
    }
  }, [complimentaryEnd, loadPlans]);

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
      if (busy.current) {
        return;
      }
      busy.current = true;
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
        busy.current = false;
        if (isMounted.current) {
          setIsBusy(false);
        }
      }
    },
    [showMessage, t],
  );

  const purchase = () => runExclusive(async () => {
    if (!chosen || complimentaryEnd) {
      return null;
    }
    const result = Platform.OS === 'android' ? await store.purchase(chosen.key, chosen) : await store.purchase(chosen.key);
    if (!isMounted.current) {
      return null;
    }
    if (result.kind === 'priceChanged') {
      setPlansState({ kind: 'ready', plans: result.plans });
      showMessage(t('subscription.result.priceChangedMessage'), { title: t('subscription.result.priceChangedTitle') });
      return null;
    }
    if (result.kind === 'unavailable' && Platform.OS === 'android') {
      setPlansState({ kind: 'unavailable', reason: result.reason });
    }
    if (result.kind === 'pending') {
      setPaymentPending(true);
    }
    return purchaseText(result);
  });
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

  // The subscriber's current plan comes from the verified store subscription.
  const isSubscribed = isSubscribedView(view);
  const otherStore = otherStoreHolding(storeSubscription ?? null, Platform.OS);
  // What subscribing NOW would mean, for the chosen plan: first payment today, the next renewal one period later. Re-derived on every
  // selection; never shown to a subscriber (whose dates are the store's and the server's).
  const summary = !isSubscribed && chosen ? describePaymentSummary(chosen.key, new Date()) : null;
  const formatLongDate = (value: string | Date) => new Intl.DateTimeFormat(i18n.language, { year: 'numeric', month: 'long', day: 'numeric' }).format(typeof value === 'string' ? new Date(value) : value);
  const subscribedPlan = isSubscribed && otherStore === null
    ? store.planOfSubscription(storeSubscription?.productId, storeSubscription?.basePlanId)
    : null;
  // The Play catalog reflects new purchases and does not give us this subscriber's next charge.
  const offerPrice = subscribedPlan && storeSubscription?.platform === 'apple'
    ? plans.find(plan => plan.key === subscribedPlan)?.localizedPrice ?? null
    : null;

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
  // Subscribed through the OTHER store (bought on Android, now on an iPhone, or the reverse): this device cannot manage it, so it says where.
  const showManage = isSubscribed && store.canManageSubscription && otherStore === null;
  const trial = view.kind === 'trial' && !complimentaryEnd ? describeTrialProgress(entitlement) : null;
  const badge = complimentaryEnd ? 'member' : membershipBadge(view, entitlement, paymentPending && !isSubscribed);

  const subscribe = () => {
    if (view.kind === 'trial') {
      setIsConfirmingTrialPurchase(true);
      return;
    }
    purchase().catch(() => undefined);
  };

  const planName = (key: PlanKey) => t(key === 'yearly' ? 'subscription.plan.yearlyName' : 'subscription.plan.monthlyName');
  const planPrice = (plan: SubscriptionPlan) => t(plan.key === 'yearly' ? 'subscription.plan.perYear' : 'subscription.plan.perMonth', { price: plan.localizedPrice });
  const renewText = (key: PlanKey) => t(key === 'yearly' ? 'subscription.plan.yearlyRenew' : 'subscription.plan.monthlyRenew');
  const cancelHow = Platform.OS === 'ios' ? t('subscription.billing.cancelHowIos') : t('subscription.billing.cancelHowAndroid');

  const renderPlan = (plan: SubscriptionPlan) => {
    // A subscriber's cards only show their plan: choosing a card changes nothing about an existing subscription (switching plans is the
    // store's own upgrade / downgrade, from Manage).
    const isSelected = (isSubscribed ? subscribedPlan : selected) === plan.key;
    const isDisabled = isBusy || isSubscribed;
    const isYearly = plan.key === 'yearly';
    const locale = i18n.language;
    return (
      <Pressable
        accessibilityLabel={`${planName(plan.key)}, ${planPrice(plan)}, ${renewText(plan.key)}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: isSelected, disabled: isDisabled }}
        disabled={isDisabled}
        key={plan.key}
        onPress={() => setSelected(plan.key)}
        style={[styles.planCard, isSelected && styles.planCardSelected]}
        testID={`subscription-plan-${plan.key}`}
      >
        <SelectedPlanFrame radius={radii.lg} selected={isSelected} />
        <View style={styles.planHeader}>
          <View style={[styles.radio, isSelected && styles.radioSelected]}>{isSelected ? <View style={styles.radioDot} /> : null}</View>
          <Text lineBreakStrategyIOS="hangul-word" numberOfLines={2} style={styles.planTitle}>{planName(plan.key)}</Text>
          {isYearly ? <GradientPill label={t('subscription.plan.recommended')} testID="subscription-recommended" /> : null}
        </View>
        <Text lineBreakStrategyIOS="hangul-word" style={styles.planPrice} testID={`subscription-price-${plan.key}`}>{planPrice(plan)}</Text>
        <Text lineBreakStrategyIOS="hangul-word" style={styles.planNote}>{renewText(plan.key)}</Text>
        {isYearly ? null : <Text lineBreakStrategyIOS="hangul-word" style={styles.planNote} testID="subscription-manage-anytime">{t('subscription.plan.manageAnytime')}</Text>}
        {isYearly && badgePercent !== null ? (
          <View style={styles.savingRow}>
            <Text lineBreakStrategyIOS="hangul-word" style={styles.discountText} testID="subscription-discount-badge">{t('subscription.plan.discountBadge', { percent: formatPercent(badgePercent, locale) })}</Text>
            {savings ? <Text lineBreakStrategyIOS="hangul-word" style={styles.planNote} testID="subscription-savings">{t('subscription.plan.saveAmount', { amount: formatMoney(savings.amount, savings.currencyCode, locale) })}</Text> : null}
          </View>
        ) : null}
        {isYearly && perMonthAmount !== null && yearly?.currencyCode ? (
          <Text lineBreakStrategyIOS="hangul-word" style={styles.planNote} testID="subscription-per-month">{t('subscription.plan.perMonthEquivalent', { price: formatMoney(perMonthAmount, yearly.currencyCode, locale) })}</Text>
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
        <MembershipHeader badge={badge} />
        {trial ? <TrialPeriodCard trial={trial} /> : null}
        {view.kind === 'trial' && !complimentaryEnd ? <NoPaymentNeededNote /> : null}
        {complimentaryEnd ? (
          <View style={[styles.card, styles.accessCard]} testID="subscription-complimentary">
            <Text style={styles.accessLabel}>{t('subscription.complimentary')}</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('subscription.row.accessEndsOn')}</Text>
              <Text style={styles.rowValue}>{formatDate(complimentaryEnd)}</Text>
            </View>
          </View>
        ) : null}

        {complimentaryEnd ? null : plansState.kind === 'unavailable' ? (
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

        {isSubscribed || complimentaryEnd ? null : (
          <>
            {summary && chosen ? (
              <View style={[styles.card, styles.summaryCard]} testID="subscription-payment-summary">
                <Text accessibilityRole="header" lineBreakStrategyIOS="hangul-word" style={styles.summaryTitle}>{t('subscription.summary.title')}</Text>
                {[
                  { id: 'plan', label: t('subscription.summary.plan'), value: planName(chosen.key) },
                  { id: 'price', label: t('subscription.summary.price'), value: planPrice(chosen) },
                  ...(trial ? [{ id: 'freeEnds', label: t('subscription.summary.freePeriodEnds'), value: formatLongDate(trial.endsAtUtc) }] : []),
                  { id: 'firstPayment', label: t('subscription.summary.firstPayment'), value: formatLongDate(summary.firstPaymentDate) },
                  { id: 'nextRenewal', label: t('subscription.summary.nextRenewal'), value: formatLongDate(summary.nextRenewalDate) },
                ].map(row => (
                  <View key={row.id} style={styles.row} testID={`subscription-summary-${row.id}`}>
                    <Text lineBreakStrategyIOS="hangul-word" style={styles.rowLabel}>{row.label}</Text>
                    <Text lineBreakStrategyIOS="hangul-word" style={styles.rowValue} testID={`subscription-summary-${row.id}-value`}>{row.value}</Text>
                  </View>
                ))}
                {trial ? (
                  <>
                    <Text lineBreakStrategyIOS="hangul-word" style={styles.summaryNote} testID="subscription-summary-no-auto-convert">{t('membership.trialPurchase.noAutoConvert')}</Text>
                    <Text lineBreakStrategyIOS="hangul-word" style={styles.summaryNote} testID="subscription-summary-charge-now">{t('membership.trialPurchase.chargeNow')}</Text>
                  </>
                ) : null}
                <Text lineBreakStrategyIOS="hangul-word" style={styles.summaryEstimate}>{t('subscription.summary.estimate')}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isReady || isBusy, busy: isBusy }}
              disabled={!isReady || isBusy}
              onPress={subscribe}
              style={[styles.primaryButton, (!isReady || isBusy) && styles.disabledButton]}
              testID="subscription-subscribe"
            >
              {isBusy ? <ActivityIndicator color={colors.onBrand} /> : <Text lineBreakStrategyIOS="hangul-word" style={styles.primaryLabel}>{t(selected === 'yearly' ? 'subscription.subscribeYearly' : 'subscription.subscribeMonthly')}</Text>}
            </Pressable>
            {chosen ? (
              <Text lineBreakStrategyIOS="hangul-word" style={styles.billingText} testID="subscription-billing-summary">
                {t(chosen.key === 'yearly' ? 'subscription.billing.summaryYearly' : 'subscription.billing.summaryMonthly', { price: chosen.localizedPrice })}
              </Text>
            ) : null}
            {entitlement?.programEnabled ? (
              <Text lineBreakStrategyIOS="hangul-word" style={styles.billingText} testID="subscription-free-notice">{t('subscription.billing.freeNotice')}</Text>
            ) : null}
            <Text lineBreakStrategyIOS="hangul-word" style={styles.billingText} testID="subscription-cancel-how">{cancelHow}</Text>
          </>
        )}

        {/* While the free month runs, the card above already is the status (its end date, its days); the summary would repeat it. */}
        {trial || (complimentaryEnd && !isSubscribed) ? null : (
          <>
            <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={styles.sectionTitle}>{t('subscription.stateHeading')}</Text>
            <View style={[styles.card, styles.accessCard]} testID="subscription-status-card">
              <Text lineBreakStrategyIOS="hangul-word" style={styles.accessLabel} testID="subscription-status">{t(`subscription.status.${view.kind}`)}</Text>
              {rows.map(row => (
                <View key={row.id} style={styles.row} testID={`subscription-row-${row.id}`}>
                  <Text lineBreakStrategyIOS="hangul-word" style={styles.rowLabel}>{row.label}</Text>
                  <Text lineBreakStrategyIOS="hangul-word" style={styles.rowValue} testID={`subscription-row-${row.id}-value`}>{row.value}</Text>
                </View>
              ))}
              {note ? <Text lineBreakStrategyIOS="hangul-word" style={styles.accessDetail} testID="subscription-status-note">{note}</Text> : null}
              {otherStore ? <Text lineBreakStrategyIOS="hangul-word" style={styles.accessDetail} testID="subscription-other-store">{t(`membership.otherStore.${otherStore}`)}</Text> : null}
            </View>
          </>
        )}

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
            <Text lineBreakStrategyIOS="hangul-word" style={styles.primaryLabel}>{t('subscription.manage')}</Text>
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
          <Text lineBreakStrategyIOS="hangul-word" style={styles.secondaryLabel}>{t('subscription.restore')}</Text>
        </Pressable>

        <View style={styles.legalRow} testID="subscription-legal">
          {legalLinks.termsUrl ? (
            <Pressable accessibilityRole="link" onPress={() => openLegal(legalLinks.termsUrl)} style={styles.legalLink} testID="subscription-terms">
              <Text lineBreakStrategyIOS="hangul-word" style={styles.legalLabel}>{t('customerCenter.terms')}</Text>
            </Pressable>
          ) : null}
          {legalLinks.privacyUrl ? (
            <Pressable accessibilityRole="link" onPress={() => openLegal(legalLinks.privacyUrl)} style={styles.legalLink} testID="subscription-privacy">
              <Text lineBreakStrategyIOS="hangul-word" style={styles.legalLabel}>{t('customerCenter.privacy')}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text lineBreakStrategyIOS="hangul-word" accessibilityRole="header" style={styles.sectionTitle}>{t('subscription.infoHeading')}</Text>
        <View style={[styles.card, styles.infoCard]} testID="subscription-info">
          {(['account', 'store', 'data'] as const).map((row, index) => (
            <View key={row} style={[styles.infoRow, index > 0 && styles.infoRowDivider]}>
              <Text lineBreakStrategyIOS="hangul-word" style={styles.infoTitle}>{t(`subscription.info.${row}Title`)}</Text>
              <Text lineBreakStrategyIOS="hangul-word" style={styles.infoBody}>{t(`subscription.info.${row}Body`)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('membership.trialPurchase.confirm')}
        destructive={false}
        message={t('membership.trialPurchase.message')}
        onCancel={() => setIsConfirmingTrialPurchase(false)}
        onConfirm={() => afterMenuCloses(() => setIsConfirmingTrialPurchase(false), () => { purchase().catch(() => undefined); })}
        onDismiss={onMenuDismiss}
        title={t('membership.trialPurchase.title')}
        visible={isConfirmingTrialPurchase && !complimentaryEnd}
      />
      {messageDialog}
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, ...cardShadow },
  accessCard: { paddingVertical: spacing.md },
  planGroup: { gap: spacing.md },
  summaryCard: { marginTop: spacing.lg },
  summaryTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  summaryNote: { color: colors.textPrimary, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  summaryEstimate: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  planCard: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: 1.5, padding: spacing.lg },
  // The selected edge is SelectedPlanFrame's gradient, drawn over a transparent border of the same width (no layout shift).
  planCardSelected: { backgroundColor: colors.brandSoft, borderColor: 'transparent' },
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
