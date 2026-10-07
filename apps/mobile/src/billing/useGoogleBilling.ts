import { useEffect, useMemo } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { getGoogleCatalog, restoreGooglePurchases, verifyGooglePurchase } from './billingApi';
import { createGoogleBilling, type GoogleBilling } from './googleBilling';

/**
 * The one entry point screens use for Google Play billing (no screen calls react-native-iap itself). The store connection is opened
 * lazily on first use and released when the screen goes away. After a SERVER-verified purchase or restore the account's entitlement
 * is re-read from the Backend - the only way the app ever learns it is paid; nothing local grants anything.
 */
export function useGoogleBilling(): GoogleBilling {
  const request = useAuthenticatedApi();
  const { refreshEntitlement } = useAuth();

  const billing = useMemo(
    () =>
      createGoogleBilling({
        api: {
          getCatalog: () => getGoogleCatalog(request),
          verify: purchaseToken => verifyGooglePurchase(request, purchaseToken),
          restore: purchaseTokens => restoreGooglePurchases(request, purchaseTokens),
        },
        refreshEntitlement,
      }),
    [request, refreshEntitlement],
  );

  useEffect(() => () => void billing.dispose(), [billing]);

  return billing;
}
