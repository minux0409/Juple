import { useEffect, useMemo } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { createAppleBilling, type AppleBilling } from './appleBilling';
import { getAppleCatalog, restoreAppleTransactions, verifyAppleTransaction } from './billingApi';

/**
 * The one entry point screens use for App Store billing (no screen calls react-native-iap itself). The StoreKit connection is opened
 * lazily on first use and released when the screen goes away. After a SERVER-verified purchase or restore the account's entitlement is
 * re-read from the Backend - the only way the app ever learns it is paid; nothing local grants anything.
 */
export function useAppleBilling(): AppleBilling {
  const request = useAuthenticatedApi();
  const { refreshEntitlement } = useAuth();

  const billing = useMemo(
    () =>
      createAppleBilling({
        api: {
          getCatalog: () => getAppleCatalog(request),
          verify: signedTransaction => verifyAppleTransaction(request, signedTransaction),
          restore: signedTransactions => restoreAppleTransactions(request, signedTransactions),
        },
        refreshEntitlement,
      }),
    [request, refreshEntitlement],
  );

  useEffect(() => () => void billing.dispose(), [billing]);

  return billing;
}
