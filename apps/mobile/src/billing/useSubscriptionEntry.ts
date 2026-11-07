import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { getAppleCatalog, getGoogleCatalog } from './billingApi';

/** The only fact the entry needs from either store's catalog: is billing enabled for this environment. */
type StoreCatalogState = { readonly enabled: boolean };

const isStorePlatform = (platform: string): boolean => platform === 'android' || platform === 'ios';

/** The catalog of THIS platform's store: Google Play on Android, the App Store on iOS. */
const readStoreCatalog = (request: AuthenticatedApiRequest): Promise<StoreCatalogState> => (Platform.OS === 'ios' ? getAppleCatalog(request) : getGoogleCatalog(request));

/**
 * Whether My Page offers the Subscription entry: the subscription PROGRAM is live (the server's bootstrap entitlement.programEnabled -
 * authoritative, never a build-time flag) AND a platform with a store (Android: Google Play, iOS: the App Store) AND the Backend's
 * catalog for THAT store says billing is enabled for this environment. While the program is off nobody is asked to pay: the Google catalog / Play product
 * can be configured and tested, but no price or purchase button reaches a person (the Subscription route itself is not registered
 * then either - see navigation/RootStack.tsx).
 */
export function shouldOfferSubscriptionEntry(platform: string, catalog: StoreCatalogState | null, programEnabled: boolean): boolean {
  return programEnabled && isStorePlatform(platform) && catalog?.enabled === true;
}

/**
 * Reads the (non-secret) catalog whenever the page regains focus - and only while the program is live. Never shows the entry before the answer is known, and a failed
 * read leaves the previous answer in place - a flaky network neither invents the entry nor makes an already-visible one flicker away.
 * On iOS nothing is requested.
 */
export type SubscriptionEntryState = 'loading' | 'available' | 'unavailable';

/**
 * The Membership screen's own question: can a subscription be started or managed here? 'loading' only while Android's store catalog is
 * being read (so the page never flashes the read-only status first); iOS and a not-live program answer 'unavailable' at once.
 */
export function useSubscriptionEntryState(): SubscriptionEntryState {
  const request = useAuthenticatedApi();
  const programEnabled = useAuth().entitlement?.programEnabled === true;
  const [state, setState] = useState<SubscriptionEntryState>(isStorePlatform(Platform.OS) && programEnabled ? 'loading' : 'unavailable');

  useFocusEffect(
    useCallback(() => {
      if (!isStorePlatform(Platform.OS) || !programEnabled) {
        setState('unavailable');
        return undefined;
      }
      let isMounted = true;
      readStoreCatalog(request)
        .then(catalog => {
          if (isMounted) {
            setState(shouldOfferSubscriptionEntry(Platform.OS, catalog, programEnabled) ? 'available' : 'unavailable');
          }
        })
        .catch(() => {
          if (isMounted) {
            setState(previous => (previous === 'loading' ? 'unavailable' : previous));
          }
        });
      return () => {
        isMounted = false;
      };
    }, [programEnabled, request]),
  );

  return state;
}

export function useSubscriptionEntryAvailable(): boolean {
  const request = useAuthenticatedApi();
  const programEnabled = useAuth().entitlement?.programEnabled === true;
  const [available, setAvailable] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isStorePlatform(Platform.OS) || !programEnabled) {
        setAvailable(false);
        return undefined;
      }
      let isMounted = true;
      readStoreCatalog(request)
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
