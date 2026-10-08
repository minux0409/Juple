import { useMemo } from 'react';
import type { GoogleBilling } from './googleBilling';
import type { SubscriptionStore } from './subscriptionStore';
import { useGoogleBilling } from './useGoogleBilling';

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
    purchase: () => billing.purchase(),
    restore: () => billing.restore(),
  };
}

/**
 * The one hook the Subscription screen uses. Android -> Google Play (useGoogleBilling already answers 'unsupportedPlatform' elsewhere,
 * so an iOS build never touches the Play store). R39-C adds the StoreKit implementation of SubscriptionStore and selects it here by
 * platform; the screen and its tests stay as they are.
 */
export function useSubscriptionStore(): SubscriptionStore {
  const billing = useGoogleBilling();
  return useMemo(() => createGoogleSubscriptionStore(billing), [billing]);
}
