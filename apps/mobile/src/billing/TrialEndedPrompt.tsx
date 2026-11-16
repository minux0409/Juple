import { CommonActions } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOptionalAuth } from '../auth/AuthContext';
import { reportDialogOpen } from '../components/dialogPresence';
import { navigationRef } from '../navigation/navigationRef';
import { describeDataRetention, formatRetentionDate } from './dataRetentionView';
import { isFreePeriodEnded } from './membershipModel';
import { MembershipPromptDialog } from './MembershipPromptDialog';
import { useQuietHome } from './useQuietHome';

const DIALOG_ID = 'trialEnded';

/** Once per running app process: 나중에 (or any close) is remembered in memory only, so the next launch asks again while it still applies. */
let answeredInThisProcess = false;

/** For tests. */
export function resetTrialEndedPromptMemory(): void {
  answeredInThisProcess = false;
}

/**
 * "Juple과 함께한 한 달, 어떠셨나요?" - when the SERVER says the free period ended and no subscription is live (isFreePeriodEnded), once per
 * launch on a quiet Home. 구독하러 가기 opens 내 페이지 and the Membership screen on top of it; 나중에, Back and a tap outside only close it -
 * nothing is bought, cancelled or changed by any of them. A subscription verified meanwhile (the entitlement turns live) closes it, and it
 * is not shown again. The saved data is never touched; when the retention policy is in effect the server's date is added to the words.
 */
export function TrialEndedPrompt() {
  const { t, i18n } = useTranslation();
  const auth = useOptionalAuth();
  const applies = isFreePeriodEnded(auth?.entitlement, auth?.storeSubscription);
  const keptUntilUtc = describeDataRetention(auth?.dataRetention)?.bodyDateUtc ?? null;
  const [isOpen, setIsOpen] = useState(false);
  const quiet = useQuietHome(applies && !answeredInThisProcess && !isOpen, DIALOG_ID);

  useEffect(() => {
    if (quiet && applies && !answeredInThisProcess) {
      setIsOpen(true);
    }
  }, [applies, quiet]);

  // Subscribed (or the program switched off) while it is open: it no longer applies.
  useEffect(() => {
    if (!applies && isOpen) {
      setIsOpen(false);
    }
  }, [applies, isOpen]);

  useEffect(() => {
    reportDialogOpen(DIALOG_ID, isOpen);
    return () => reportDialogOpen(DIALOG_ID, false);
  }, [isOpen]);

  const close = () => {
    answeredInThisProcess = true;
    setIsOpen(false);
  };

  const openMembership = () => {
    close();
    if (navigationRef.isReady()) {
      // 내 페이지 first, then the Membership screen on top: Back from it lands on 내 페이지.
      navigationRef.dispatch(CommonActions.navigate({ name: 'MainTabs', params: { screen: 'MyPage' } }));
      navigationRef.navigate('Subscription');
    }
  };

  const body = keptUntilUtc
    ? `${t('trialEnded.body')}\n\n${t('retention.keptUntil', { date: formatRetentionDate(keptUntilUtc, i18n.language) })}`
    : t('trialEnded.body');

  return (
    <MembershipPromptDialog
      body={body}
      icon="heart"
      onPrimary={openMembership}
      onRequestClose={close}
      onSecondary={close}
      primaryLabel={t('trialEnded.subscribe')}
      secondaryLabel={t('trialEnded.later')}
      testID="trial-ended"
      title={t('trialEnded.title')}
      visible={isOpen}
    />
  );
}
