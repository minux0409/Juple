import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { navigationRef } from '../navigation/navigationRef';
import { subscribeSubscriptionRequired, type SubscriptionRequiredKind } from './subscriptionRequired';

/**
 * The one place a refused write turns into words. Whatever screen made the request, the person gets the same short
 * explanation, once (the shared notice dialogs stay quiet right after a refusal - see ConfirmDialog):
 * - their own free period ended: saved links stay readable, a subscription brings saving and editing back, with a way straight
 *   to the subscription screen (which also holds 구매 복원);
 * - the Collection's OWNER has no live access: nothing the person could buy changes it, so it is a plain notice that the
 *   Collection can be read but not changed for now.
 * Repeated refusals while it is open change nothing.
 */
export function SubscriptionRequiredPrompt() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SubscriptionRequiredKind | null>(null);

  useEffect(() => subscribeSubscriptionRequired(refusal => setKind(previous => previous ?? refusal)), []);

  const close = () => setKind(null);
  const isOwner = kind === 'owner';

  return (
    <ConfirmDialog
      cancelLabel={isOwner ? undefined : t('subscription.required.later')}
      confirmLabel={isOwner ? t('common.confirm') : t('subscription.subscribe')}
      destructive={false}
      message={isOwner ? t('subscription.ownerRequired.message') : t('subscription.required.message')}
      onCancel={isOwner ? undefined : close}
      onConfirm={() => {
        const wasActor = kind === 'actor';
        close();
        if (wasActor && navigationRef.isReady()) {
          navigationRef.navigate('Subscription');
        }
      }}
      title={isOwner ? t('subscription.ownerRequired.title') : t('subscription.required.title')}
      visible={kind !== null}
    />
  );
}
