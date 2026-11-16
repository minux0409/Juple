import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useOptionalAuth } from '../auth/AuthContext';
import { reportDialogOpen } from '../components/dialogPresence';
import { hasCompletedAnyLegacyTutorial } from '../settings/tutorialPreference';
import { ONBOARDING_GUIDE_ID, findTourGuide } from '../tour/tourGuides';
import { hasCompletedTour } from '../tour/tourPreference';
import { describeTrialProgress } from './membershipModel';
import { MembershipPromptDialog } from './MembershipPromptDialog';
import { dismissTrialNotice } from './trialNoticeModel';
import { useQuietHome } from './useQuietHome';
import { isWelcomeTrialPending, markWelcomeTrialShown, rememberWelcomeTrial } from './welcomeTrialStore';

const DIALOG_ID = 'welcomeTrial';

/**
 * "Juple에 오신 걸 환영해요!" - once, for a NEW account that the server gave its own free month (bootstrap `newAccountTrialGranted`; see
 * welcomeTrialStore for how it survives a closed app and why other devices never see it). It waits for Home to be in front and for the
 * first-run tour to be finished or skipped (or not to apply), then shows; closing it any way - the button, Back, a tap outside - only
 * closes it and records it as shown. Mounted beside the navigator once sign-in and bootstrap are done (navigation/RootStack).
 * It also closes the Home "your free period has started" card for the same period, so the person is not told twice.
 */
export function WelcomeTrialPrompt() {
  const { t } = useTranslation();
  const auth = useOptionalAuth();
  const request = useAuthenticatedApi();
  const grantedNow = auth?.newAccountTrialGranted === true;
  const trial = describeTrialProgress(auth?.entitlement);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // Closed in this launch: nothing (a re-read, the server's flag still set in memory) may bring it back.
  const closedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    getMyProfile(request)
      .then(async profile => {
        if (grantedNow) {
          await rememberWelcomeTrial(profile.jupleId);
        }
        // The stored record decides once it exists ('shown' is never pending again); unreadable storage falls back to this launch's answer.
        const stored = await isWelcomeTrialPending(profile.jupleId);
        const pending = !closedRef.current && (stored ?? grantedNow);
        if (mounted) {
          setUserKey(profile.jupleId);
          setIsPending(pending);
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [grantedNow, request]);

  // The first-run tour comes first: the welcome waits until it was finished or skipped, or it never applies to this person here.
  const quiet = useQuietHome(isPending && userKey !== null && trial !== null && !isOpen, DIALOG_ID, async () => {
    const guide = findTourGuide(ONBOARDING_GUIDE_ID);
    if (!userKey || !guide) {
      return true;
    }
    return (await hasCompletedAnyLegacyTutorial(userKey)) || hasCompletedTour(guide.id, guide.version, userKey);
  });

  useEffect(() => {
    if (quiet && isPending && trial !== null) {
      setIsOpen(true);
    }
  }, [isPending, quiet, trial]);

  useEffect(() => {
    reportDialogOpen(DIALOG_ID, isOpen);
    return () => reportDialogOpen(DIALOG_ID, false);
  }, [isOpen]);

  const close = () => {
    closedRef.current = true;
    setIsOpen(false);
    setIsPending(false);
    if (userKey) {
      markWelcomeTrialShown(userKey).catch(() => undefined);
    }
    if (trial) {
      dismissTrialNotice({ kind: 'welcome', endsAtUtc: trial.endsAtUtc }, Date.now()).catch(() => undefined);
    }
  };

  return (
    <MembershipPromptDialog
      body={t('welcomeTrial.body', { myPage: t('tabs.myPage') })}
      icon="gift"
      onPrimary={close}
      onRequestClose={close}
      primaryLabel={t('welcomeTrial.start')}
      testID="welcome-trial"
      title={t('welcomeTrial.title')}
      visible={isOpen}
    />
  );
}
