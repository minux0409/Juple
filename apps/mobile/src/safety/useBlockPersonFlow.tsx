import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useMessageDialog } from '../components/useMessageDialog';
import { blockUser, unblockUser } from './safetyApi';
import { publishBlockChange, useBlockedUsers } from './useBlockedUsers';

export interface BlockSubject {
  readonly jupleId: string;
  readonly name: string;
}

/**
 * 사용자 차단 / 차단 해제: the short question (title, and where to undo it), then the block. The same flow and the same dialog wherever a
 * person's menu offers it (a Collection's participants, the friends list); the server decides what a block stops. `onBlocked` runs once the
 * server accepted the block, for a screen that lists the person (the friends list drops them: blocking ends the friendship).
 *
 * The menu asks `isBlocked(jupleId)` for the word to show and `canChangeBlock` before offering either action: until the server has said who
 * I blocked the state is unknown, and a block must not start from an unknown state. A person who is already blocked is never asked again -
 * the menu offers 차단 해제 instead, and a stale tap on 차단 is ignored here. Unblocking restores no friendship or invitation.
 */
export function useBlockPersonFlow(onBlocked?: (person: BlockSubject) => void, options?: { readonly knownNotBlocked?: boolean }) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showMessage, messageDialog } = useMessageDialog();
  const { status, isBlocked } = useBlockedUsers(options?.knownNotBlocked !== true);
  const [subject, setSubject] = useState<BlockSubject | null>(null);
  const [isBlocking, setIsBlocking] = useState(false);
  const busyRef = useRef(false);

  const confirm = async () => {
    if (subject === null || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBlocking(true);
    try {
      await blockUser(request, subject.jupleId);
      const blocked = subject;
      setSubject(null);
      publishBlockChange(blocked.jupleId, true);
      onBlocked?.(blocked);
      showMessage(t('safety.blockedDone'));
    } catch {
      setSubject(null);
      showMessage(t('safety.blockFailed'));
    } finally {
      busyRef.current = false;
      setIsBlocking(false);
    }
  };

  const requestBlock = useCallback((person: BlockSubject) => {
    if (status === 'ready' && !isBlocked(person.jupleId)) {
      setSubject(person);
    }
  }, [isBlocked, status]);

  const requestUnblock = useCallback(async (person: BlockSubject) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await unblockUser(request, person.jupleId);
      publishBlockChange(person.jupleId, false);
      showMessage(t('safety.unblockedDone'));
    } catch {
      showMessage(t('importantState.loadFailedTitle'));
    } finally {
      busyRef.current = false;
    }
  }, [request, showMessage, t]);

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
  return { requestBlock, requestUnblock, isBlocked, canChangeBlock: status === 'ready', blockDialogs } as const;
}
