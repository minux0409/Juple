import { useEffect, useRef, useState } from 'react';
import { getMyProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { navigationRef } from '../navigation/navigationRef';
import { hasCompletedAnyLegacyTutorial } from '../settings/tutorialPreference';
import { useIncomingShare } from '../share/useIncomingShare';
import { startTour } from './tourController';
import { ONBOARDING_GUIDE_ID, TOUR_TARGETS, findTourGuide } from './tourGuides';
import { hasCompletedTour } from './tourPreference';
import { measureTourTarget } from './tourTargets';

const CHECK_INTERVAL_MS = 300;
/** How long one app launch keeps waiting for Home to be ready; after that the tour simply waits for the next launch. */
const GIVE_UP_AFTER_MS = 120_000;

/**
 * Headless (renders nothing; mounted beside the navigator once sign-in AND bootstrap are done): starts the short on-screen tour for a
 * NEW person, once. It is the only automatic first run - the old six-page tutorial is reachable from 도움말 only.
 *
 * Who counts as new: this device has no record of the old tutorial (any version) and no record of this tour for that Juple ID. Anyone
 * who used the app before the tour existed has the old record, so an update never interrupts them. A person who already used Juple on
 * ANOTHER device and signs in here for the first time cannot be told apart from a new person without a server-side signal, so they
 * get the tour once (it is skippable) - exactly as the old tutorial behaved on a new device.
 *
 * It never blocks startup and never competes with where the app was asked to go: a Collection share link or a pending incoming share
 * is resolved first, the terms agreement comes before this component exists, and the tour starts only when the main tabs are in
 * front AND the Home input can really be measured (no fixed delay).
 */
export function OnboardingTourLauncher(): null {
  const request = useAuthenticatedApi();
  const { pendingShare } = useIncomingShare();
  const [pendingUserKey, setPendingUserKey] = useState<string | null>(null);
  const startedRef = useRef(false);
  const pendingShareRef = useRef(pendingShare);
  useEffect(() => {
    pendingShareRef.current = pendingShare;
  }, [pendingShare]);

  useEffect(() => {
    let isMounted = true;
    const guide = findTourGuide(ONBOARDING_GUIDE_ID);
    getMyProfile(request)
      .then(async profile => {
        if (!isMounted || !guide) {
          return;
        }
        const knowsTheApp = (await hasCompletedAnyLegacyTutorial(profile.jupleId)) || (await hasCompletedTour(guide.id, guide.version, profile.jupleId));
        if (isMounted && !knowsTheApp) {
          setPendingUserKey(profile.jupleId);
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, [request]);

  useEffect(() => {
    if (pendingUserKey === null) {
      return undefined;
    }
    let active = true;
    let measuring = false;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (startedRef.current || Date.now() - startedAt > GIVE_UP_AFTER_MS) {
        clearInterval(timer);
        return;
      }
      // One measure at a time: a slow native answer never stacks up behind the next tick.
      if (measuring) {
        return;
      }
      if (pendingShareRef.current || !navigationRef.isReady()) {
        return;
      }
      // The ROOT stack's top screen (getCurrentRoute would name the focused tab inside MainTabs).
      const rootState = navigationRef.getRootState();
      if (rootState?.routes[rootState.index]?.name !== 'MainTabs') {
        return;
      }
      measuring = true;
      measureTourTarget(TOUR_TARGETS.homeInput)
        .then(rect => {
          measuring = false;
          if (active && rect && !startedRef.current && !pendingShareRef.current) {
            startedRef.current = true;
            clearInterval(timer);
            startTour(ONBOARDING_GUIDE_ID, { userKey: pendingUserKey });
          }
        })
        .catch(() => {
          measuring = false;
        });
    }, CHECK_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pendingUserKey]);

  return null;
}
