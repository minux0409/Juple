import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getGoogleCatalog } from './billingApi';
import type { GoogleCatalog } from './types';

/**
 * Whether My Page offers the Subscription entry: Android (Google Play is the only store implemented) AND the Backend's catalog says
 * Google billing is enabled for this environment. Deliberately independent of the subscription PROGRAM (entitlement.programEnabled):
 * that flag only decides whether a subscription is required and writes are restricted - being able to see the plan, its Play price
 * and to buy or manage it is a normal account feature whether or not the program is launched.
 */
export function shouldOfferSubscriptionEntry(platform: string, catalog: GoogleCatalog | null): boolean {
  return platform === 'android' && catalog?.enabled === true;
}

/**
 * Reads the (non-secret) catalog whenever the page regains focus. Never shows the entry before the answer is known, and a failed
 * read leaves the previous answer in place - a flaky network neither invents the entry nor makes an already-visible one flicker away.
 * On iOS nothing is requested.
 */
export function useSubscriptionEntryAvailable(): boolean {
  const request = useAuthenticatedApi();
  const [available, setAvailable] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }
      let isMounted = true;
      getGoogleCatalog(request)
        .then(catalog => {
          if (isMounted) {
            setAvailable(shouldOfferSubscriptionEntry(Platform.OS, catalog));
          }
        })
        .catch(() => undefined);
      return () => {
        isMounted = false;
      };
    }, [request]),
  );

  return available;
}
