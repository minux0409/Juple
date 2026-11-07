import { useMemo } from 'react';
import { Linking, Platform } from 'react-native';
import type { AppleBilling } from './appleBilling';
import type { GoogleBilling } from './googleBilling';
import type { SubscriptionPlan, SubscriptionStore } from './subscriptionStore';
import { useAppleBilling } from './useAppleBilling';
import { useGoogleBilling } from './useGoogleBilling';

/** Google Play's own subscription-management page (no product or account id needed - it lists the person's subscriptions). */
const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';
/** The App Store's subscription-management page (the person's own subscriptions; no product or account id needed). */
const APP_STORE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** Google Play behind the store-neutral contract: only the localized price facts leave; the offer token and account id stay inside. */
export function createGoogleSubscriptionStore(billing: GoogleBilling): SubscriptionStore {
  return {
    loadOffer: async () => {
      const result = await billing.loadOffer();
      if (result.kind !== 'ready') {
        return result;
      }
      const { localizedPrice, currencyCode, billingPeriod } = result.offer;
      return { kind: 'ready', offer: { localizedPrice, currencyCode, billingPeriod } };
    },
    loadPlans: async () => {
      const result = await billing.loadPlans();
      if (result.kind !== 'ready') {
        return result;
      }
      const plans: SubscriptionPlan[] = [];
      for (const offer of result.offers) {
        if (offer.plan) {
          plans.push({ key: offer.plan, localizedPrice: offer.localizedPrice, currencyCode: offer.currencyCode, billingPeriod: offer.billingPeriod, priceAmount: offer.priceAmount });
        }
      }
      return plans.length > 0 ? { kind: 'ready', plans } : { kind: 'unavailable', reason: 'offerNotFound' };
    },
    purchase: plan => billing.purchase(plan),
    restore: () => billing.restore(),
    canManageSubscription: Platform.OS === 'android',
    openSubscriptionManagement: () => Linking.openURL(PLAY_SUBSCRIPTIONS_URL),
  };
}

/** The App Store behind the same contract: the product ids and the App Account Token stay inside the StoreKit layer. */
export function createAppleSubscriptionStore(billing: AppleBilling): SubscriptionStore {
  const loadPlans: SubscriptionStore['loadPlans'] = async () => {
    const result = await billing.loadPlans();
    if (result.kind !== 'ready') {
      return result;
    }
    return {
      kind: 'ready',
      plans: result.plans.map(plan => ({ key: plan.plan, localizedPrice: plan.localizedPrice, currencyCode: plan.currencyCode, billingPeriod: plan.billingPeriod, priceAmount: plan.priceAmount })),
    };
  };
  return {
    loadOffer: async () => {
      const result = await loadPlans();
      if (result.kind !== 'ready') {
        return result;
      }
      const monthly = result.plans.find(plan => plan.key === 'monthly') ?? result.plans[0];
      return { kind: 'ready', offer: { localizedPrice: monthly.localizedPrice, currencyCode: monthly.currencyCode, billingPeriod: monthly.billingPeriod } };
    },
    loadPlans,
    purchase: plan => billing.purchase(plan ?? 'monthly'),
    restore: () => billing.restore(),
    canManageSubscription: Platform.OS === 'ios',
    openSubscriptionManagement: () => Linking.openURL(APP_STORE_SUBSCRIPTIONS_URL),
  };
}

/**
 * The one hook the Subscription screen uses: Google Play on Android, the App Store on iOS. Each billing hook answers
 * 'unsupportedPlatform' on the other platform without touching its store, so an iOS build never opens the Play store and vice versa.
 */
export function useSubscriptionStore(): SubscriptionStore {
  const google = useGoogleBilling();
  const apple = useAppleBilling();
  return useMemo(() => (Platform.OS === 'ios' ? createAppleSubscriptionStore(apple) : createGoogleSubscriptionStore(google)), [apple, google]);
}
