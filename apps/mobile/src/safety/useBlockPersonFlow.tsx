import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useMessageDialog } from '../components/useMessageDialog';
import { blockUser } from './safetyApi';

export interface BlockSubject {
  readonly jupleId: string;
  readonly name: string;
}

/**
 * 사용자 차단: the question naming the person and what it does, then the block. The same flow wherever a participant's menu offers it; the
 * server decides what a block stops. Links and memberships stay, which is why the message says so and nothing here reloads a member list.
 */
export function useBlockPersonFlow() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showMessage, messageDialog } = useMessageDialog();
  const [subject, setSubject] = useState<BlockSubject | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);

  const confirm = async () => {
    if (subject === null || isBlocking) {
      return;
    }
    setIsBlocking(true);
    try {
      await blockUser(request, subject.jupleId);
      setSubject(null);
      showMessage(t('safety.blockedDone'));
    } catch {
      setSubject(null);
      showMessage(t('safety.blockFailed'));
    } finally {
      setIsBlocking(false);
    }
  };

  const requestBlock = useCallback((person: BlockSubject) => setSubject(person), []);

  const blockDialogs = (
    <>
      <ConfirmDialog
        busy={isBlocking}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('safety.block')}
        message={t('safety.blockConfirmMessage', { name: subject?.name ?? '' })}
        onCancel={() => { if (!isBlocking) { setSubject(null); } }}
        onConfirm={() => { confirm().catch(() => undefined); }}
        title={t('safety.blockTitle')}
        visible={subject !== null}
      />
      {messageDialog}
    </>
  );
  return { requestBlock, blockDialogs } as const;
}
