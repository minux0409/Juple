import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { useSubscriptionStore } from '../billing/useSubscriptionStore';
import type { SubscriptionOffer } from '../billing/subscriptionStore';
import type { OfferUnavailableReason, PurchaseResult, RestoreResult } from '../billing/types';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useMessageDialog } from '../components/useMessageDialog';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

type OfferState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly offer: SubscriptionOffer }
  | { readonly kind: 'unavailable'; readonly reason: OfferUnavailableReason };

const MONTHLY_PERIOD = 'P1M';

/**
 * Subscription: the monthly plan, the localized price exactly as the store reports it, the account's current access, Subscribe and
 * Restore purchases. Store-neutral: it talks only to useSubscriptionStore (Google Play today, the App Store later) and never decides
 * access - a purchase or restore resolves only after the Backend verified it, and the access line shown is the account entitlement
 * the Backend reports. The price is never hardcoded: with no store price there is no price and no Subscribe, only a retry.
 */
export function SubscriptionScreen() {
  const { t } = useTranslation();
  const store = useSubscriptionStore();
  const { entitlement } = useAuth();
  const { showMessage, messageDialog } = useMessageDialog();
  const [offerState, setOfferState] = useState<OfferState>({ kind: 'loading' });
  const [isBusy, setIsBusy] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadOffer = useCallback(async () => {
    setOfferState({ kind: 'loading' });
    const result = await store.loadOffer();
    if (isMounted.current) {
      setOfferState(result.kind === 'ready' ? { kind: 'ready', offer: result.offer } : { kind: 'unavailable', reason: result.reason });
    }
  }, [store]);

  useEffect(() => {
    loadOffer().catch(() => {
      if (isMounted.current) {
        setOfferState({ kind: 'unavailable', reason: 'storeUnavailable' });
      }
    });
  }, [loadOffer]);

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

  const subscribe = () => runExclusive(async () => purchaseText(await store.purchase()));
  const restore = () => runExclusive(async () => restoreText(await store.restore()));

  const accessLabel = entitlement?.programEnabled && entitlement.status ? t(`subscription.access.${entitlement.status}`) : t('subscription.access.inactive');
  const isReady = offerState.kind === 'ready';

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {offerState.kind === 'unavailable' ? (
          <LoadFailureState
            error={offerState.reason === 'storeUnavailable' ? new Error('store') : undefined}
            notice={offerState.reason === 'storeUnavailable' ? null : unavailableText(offerState.reason)}
            onRetry={() => { loadOffer().catch(() => undefined); }}
            testID="subscription-unavailable"
          />
        ) : (
          <View style={styles.card}>
            <Text style={styles.planName}>{t('subscription.planName')}</Text>
            {offerState.kind === 'ready' ? (
              <Text style={styles.price} testID="subscription-price">
                {offerState.offer.billingPeriod === MONTHLY_PERIOD ? t('subscription.pricePerMonth', { price: offerState.offer.localizedPrice }) : offerState.offer.localizedPrice}
              </Text>
            ) : (
              <ActivityIndicator accessibilityLabel={t('subscription.loading')} color={colors.textSecondary} style={styles.loader} testID="subscription-loading" />
            )}
            <Text style={styles.body}>{t('subscription.cadence')}</Text>
            <Text style={styles.body}>{t('subscription.cancelNote')}</Text>
          </View>
        )}

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('subscription.accessHeading')}</Text>
        <View style={[styles.card, styles.accessCard]}>
          <Text style={styles.accessLabel} testID="subscription-access">{accessLabel}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !isReady || isBusy, busy: isBusy }}
          disabled={!isReady || isBusy}
          onPress={() => { subscribe().catch(() => undefined); }}
          style={[styles.primaryButton, (!isReady || isBusy) && styles.disabledButton]}
          testID="subscription-subscribe"
        >
          {isBusy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryLabel}>{t('subscription.subscribe')}</Text>}
        </Pressable>
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
      </ScrollView>
      {messageDialog}
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, ...cardShadow },
  accessCard: { paddingVertical: spacing.md },
  planName: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  price: { color: colors.textPrimary, flexShrink: 1, fontSize: 24, fontWeight: '700', marginTop: spacing.sm },
  loader: { alignSelf: 'flex-start', marginTop: spacing.md },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.xl },
  accessLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.lg, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.brand, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  disabledButton: { opacity: 0.5 },
});
