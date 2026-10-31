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
 * 사용자 차단: the short question (title, and where to undo it), then the block. The same flow and the same dialog wherever a person's menu
 * offers it (a Collection's participants, the friends list); the server decides what a block stops. `onBlocked` runs once the server accepted
 * the block, for a screen that lists the person (the friends list drops them: blocking ends the friendship).
 */
export function useBlockPersonFlow(onBlocked?: (person: BlockSubject) => void) {
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
      const blocked = subject;
      setSubject(null);
      onBlocked?.(blocked);
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
        message={t('safety.blockConfirmMessage')}
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
