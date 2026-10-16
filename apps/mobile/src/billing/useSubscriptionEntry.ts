import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { getGoogleCatalog } from './billingApi';
import type { GoogleCatalog } from './types';

/**
 * Whether My Page offers the Subscription entry: the subscription PROGRAM is live (the server's bootstrap entitlement.programEnabled -
 * authoritative, never a build-time flag) AND Android (Google Play is the only store implemented) AND the Backend's catalog says
 * Google billing is enabled for this environment. While the program is off nobody is asked to pay: the Google catalog / Play product
 * can be configured and tested, but no price or purchase button reaches a person (the Subscription route itself is not registered
 * then either - see navigation/RootStack.tsx).
 */
export function shouldOfferSubscriptionEntry(platform: string, catalog: GoogleCatalog | null, programEnabled: boolean): boolean {
  return programEnabled && platform === 'android' && catalog?.enabled === true;
}

/**
 * Reads the (non-secret) catalog whenever the page regains focus - and only while the program is live. Never shows the entry before the answer is known, and a failed
 * read leaves the previous answer in place - a flaky network neither invents the entry nor makes an already-visible one flicker away.
 * On iOS nothing is requested.
 */
export function useSubscriptionEntryAvailable(): boolean {
  const request = useAuthenticatedApi();
  const programEnabled = useAuth().entitlement?.programEnabled === true;
  const [available, setAvailable] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android' || !programEnabled) {
        setAvailable(false);
        return undefined;
      }
      let isMounted = true;
      getGoogleCatalog(request)
        .then(catalog => {
          if (isMounted) {
            setAvailable(shouldOfferSubscriptionEntry(Platform.OS, catalog, programEnabled));
          }
        })
        .catch(() => undefined);
      return () => {
        isMounted = false;
      };
    }, [programEnabled, request]),
  );

  return available;
}
