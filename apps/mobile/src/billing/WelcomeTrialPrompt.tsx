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
import { markWelcomeTrialShown, readWelcomeTrialState, rememberWelcomeTrial } from './welcomeTrialStore';

const DIALOG_ID = 'welcomeTrial';

/**
 * "가입해 주셔서 감사해요!" - the free-trial popup, once per account on this device, for anyone the server reports in a running free trial
 * (it replaced the Home trial card). A NEW account (bootstrap `newAccountTrialGranted`, remembered by welcomeTrialStore until shown) reads
 * "from the day you joined"; everyone else in a trial is an existing member and reads "from the membership start". It waits for Home to be
 * in front and for the first-run tour to be finished or skipped (or not to apply), then shows; closing it any way - the button, Back, a tap
 * outside - only closes it and records it as shown, so it never comes back. Nothing is bought or charged from here.
 */
export function WelcomeTrialPrompt() {
  const { t } = useTranslation();
  const auth = useOptionalAuth();
  const request = useAuthenticatedApi();
  const grantedNow = auth?.newAccountTrialGranted === true;
  const trial = describeTrialProgress(auth?.entitlement);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isNewAccount, setIsNewAccount] = useState(false);
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
        // 'shown' never comes back. Unreadable storage shows it only to an account the server just created (never on every launch).
        const stored = await readWelcomeTrialState(profile.jupleId);
        const pending = !closedRef.current && (stored === null ? grantedNow : stored !== 'shown');
        if (mounted) {
          setUserKey(profile.jupleId);
          setIsNewAccount(stored === 'new' || grantedNow);
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
      body={`${t(isNewAccount ? 'welcomeTrial.newMemberBody' : 'welcomeTrial.existingMemberBody')}\n\n${t('welcomeTrial.plansAfterTrial')}`}
      icon="gift"
      onPrimary={close}
      onRequestClose={close}
      primaryLabel={t('common.close')}
      testID="welcome-trial"
      title={t('welcomeTrial.thanksTitle')}
      visible={isOpen}
    />
  );
}
