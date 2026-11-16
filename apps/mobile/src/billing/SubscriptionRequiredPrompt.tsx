import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { reportDialogOpen, useIsOtherDialogOpen } from '../components/dialogPresence';
import { useOptionalAuth } from '../auth/AuthContext';
import { describeDataRetention, formatRetentionDate } from './dataRetentionView';
import { isFreePeriodEnded } from './membershipModel';
import { openMembershipFromMyPage } from './openMembership';
import { subscribeSubscriptionRequired, type SubscriptionRequiredKind } from './subscriptionRequired';

/**
 * The one place a refused write turns into words. Whatever screen made the request, the person gets the same short
 * explanation, once (the shared notice dialogs stay quiet right after a refusal - see ConfirmDialog):
 * - their own access ended ("멤버십이 필요한 기능이에요"): the free month ended - or, for someone whose paid membership lapsed, the
 *   membership ended - saved links stay readable, a membership brings saving and editing back. 멤버십 보기 opens 내 페이지 and the
 *   Membership screen (which also holds 구매 복원); 닫기, Back and a tap outside only close it;
 * - the Collection's OWNER has no live access: nothing the person could buy changes it, so it is a plain notice that the
 *   Collection can be read but not changed for now.
 * Repeated refusals while it is open change nothing. A refusal that arrives while another popup is up (the free-month-ended notice)
 * waits until that one has gone - iOS shows one modal at a time - and the membership popups wait for this one in turn.
 */
const DIALOG_ID = 'subscriptionRequired';

export function SubscriptionRequiredPrompt() {
  const { t, i18n } = useTranslation();
  const auth = useOptionalAuth();
  const [kind, setKind] = useState<SubscriptionRequiredKind | null>(null);
  // The server's retention date, when the policy is in effect: the refusal then also says until when the saved data is kept.
  const keptUntilUtc = describeDataRetention(auth?.dataRetention)?.bodyDateUtc ?? null;
  // "Your free period has ended" only when that is what ended; a lapsed paid membership is told so instead.
  const reason = isFreePeriodEnded(auth?.entitlement, auth?.storeSubscription) ? t('subscription.required.message') : t('subscription.required.messageEnded');
  const actorMessage = keptUntilUtc
    ? `${reason}\n\n${t('retention.keptUntil', { date: formatRetentionDate(keptUntilUtc, i18n.language) })}`
    : reason;

  useEffect(() => subscribeSubscriptionRequired(refusal => setKind(previous => previous ?? refusal)), []);
  const isBehindAnother = useIsOtherDialogOpen(DIALOG_ID);
  const isShown = kind !== null && !isBehindAnother;
  useEffect(() => {
    reportDialogOpen(DIALOG_ID, isShown);
    return () => reportDialogOpen(DIALOG_ID, false);
  }, [isShown]);

  const close = () => setKind(null);
  const isOwner = kind === 'owner';

  return (
    <ConfirmDialog
      cancelLabel={isOwner ? undefined : t('common.close')}
      confirmLabel={isOwner ? t('common.confirm') : t('subscription.required.view')}
      destructive={false}
      message={isOwner ? t('subscription.ownerRequired.message') : actorMessage}
      onCancel={isOwner ? undefined : close}
      onConfirm={() => {
        const wasActor = kind === 'actor';
        close();
        if (wasActor) {
          openMembershipFromMyPage();
        }
      }}
      title={isOwner ? t('subscription.ownerRequired.title') : t('subscription.required.title')}
      visible={isShown}
    />
  );
}
