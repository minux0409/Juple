import { useEffect, useRef, useState } from 'react';
import { getMyProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { navigationRef } from '../navigation/navigationRef';
import { useIncomingShare } from '../share/useIncomingShare';
import { hasCompletedTutorial } from '../settings/tutorialPreference';

/**
 * Headless (renders nothing, like IncomingShareRouter - which it is mounted beside, only once the full
 * navigation stack exists, i.e. after sign-in AND bootstrap): shows the tutorial once per person and tutorial
 * version.
 *
 * It never blocks startup: nothing waits for it and a failure here (no profile, no storage) just means no
 * tutorial this time. It never competes with where the app was asked to go: a Collection share link
 * (SharedCollection) or a pending incoming share (NewLinkReview) is resolved first, and the tutorial waits
 * until the main tabs are in front with nothing pending.
 */
export function TutorialLauncher(): null {
  const request = useAuthenticatedApi();
  const { pendingShare } = useIncomingShare();
  // Set once this person is known to still owe the tutorial.
  const [pendingUserKey, setPendingUserKey] = useState<string | null>(null);
  const shownRef = useRef(false);
  const pendingShareRef = useRef(pendingShare);
  pendingShareRef.current = pendingShare;

  useEffect(() => {
    let isMounted = true;
    getMyProfile(request)
      .then(async profile => {
        if (isMounted && !(await hasCompletedTutorial(profile.jupleId))) {
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
    const showIfClear = () => {
      if (shownRef.current || pendingShareRef.current || !navigationRef.isReady()) {
        return;
      }
      // The ROOT stack's top screen (getCurrentRoute would name the focused tab, e.g. Home, inside MainTabs).
      const rootState = navigationRef.getRootState();
      if (rootState?.routes[rootState.index]?.name !== 'MainTabs') {
        return;
      }
      shownRef.current = true;
      navigationRef.navigate('Tutorial', { mode: 'firstRun', userKey: pendingUserKey });
    };
    showIfClear();
    // Re-checked whenever navigation settles somewhere else (e.g. back from a shared Collection to the tabs).
    const unsubscribe = navigationRef.isReady() ? navigationRef.addListener('state', showIfClear) : undefined;
    return unsubscribe;
  }, [pendingShare, pendingUserKey]);

  return null;
}
