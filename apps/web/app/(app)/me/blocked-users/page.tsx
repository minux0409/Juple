'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { formatMessage } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { collectionHref } from '../../../../lib/savedLinks';
import { BLOCKED_USERS_PATH, blockPath, parseBlockedUsers, type BlockedUser } from '../../../../lib/safety';
import { useSignedInApp } from '../../AppRoot';
import { Avatar } from '../../Avatar';
import { ConfirmDialog } from '../../ConfirmDialog';
import { LoadFailed } from '../../PageStates';
import { useToast } from '../../Toaster';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

const nameOf = (person: BlockedUser) => person.displayName ?? formatJupleId(person.jupleId);

/**
 * 차단한 사용자 (내 페이지 > 친구 관리): the people I blocked, when, and 차단 해제 behind a confirmation - the mobile screen, on the same API. A Collection
 * of theirs that I am still a member of is out of my lists: it is listed here, so opening or leaving it stays possible.
 */
export default function BlockedUsersPage() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [people, setPeople] = useState<readonly BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState<BlockedUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api<unknown>({ method: 'GET', path: BLOCKED_USERS_PATH }).then(
      raw => {
        if (current) {
          setFailed(false);
          setPeople(parseBlockedUsers(raw));
        }
      },
      caught => {
        if (!current) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [api, onSessionLost, reloadToken]);

  const unblock = useCallback(() => {
    if (!pending || busy) {
      return;
    }
    setBusy(true);
    api<void>({ method: 'DELETE', path: blockPath(pending.jupleId) }).then(
      () => {
        setBusy(false);
        setPeople(current => current?.filter(person => person.jupleId !== pending.jupleId) ?? null);
        setPending(null);
        toast.showNotice(dictionary.safetyUnblockedDone);
      },
      caught => {
        setBusy(false);
        setPending(null);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
  }, [api, busy, dictionary.safetyUnblockedDone, onSessionLost, pending, toast]);

  const blockedOn = (person: BlockedUser) => {
    const date = new Date(person.blockedAtUtc);
    return Number.isNaN(date.getTime()) ? '' : formatMessage(dictionary.safetyBlockedAt, { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date) });
  };

  return (
    <SettingsPage backHref="/me/friends" icon="People" title={dictionary.safetyBlockedUsers} width="medium">
      {failed ? <LoadFailed dictionary={dictionary} onRetry={() => setReloadToken(token => token + 1)} /> : null}
      {people?.length === 0 ? <p className={styles.settingsHeading}>{dictionary.safetyBlockedUsersEmpty}</p> : null}
      <ul className={styles.personCards}>
        {people?.map(person => (
          <li className={styles.personCard} data-blocked-user key={person.jupleId}>
            <Avatar person={{ displayName: person.displayName, profileImageUrl: person.profileImageUrl }} size={40} />
            <span className={styles.personText}>
              <span dir="auto">{nameOf(person)}</span>
              <span className={styles.profileId} dir="ltr">{formatJupleId(person.jupleId)}</span>
              <span className={styles.profileId}>{blockedOn(person)}</span>
              {person.hiddenCollections.length > 0 ? (
                <>
                  <span className={styles.profileId}>{dictionary.safetyHiddenCollectionsTitle}</span>
                  {person.hiddenCollections.map(collection => (
                    <Link dir="auto" href={collectionHref(collection.id)} key={collection.id}>{collection.name}</Link>
                  ))}
                </>
              ) : null}
            </span>
            <button className={styles.settingsAction} onClick={() => setPending(person)} type="button">
              {dictionary.safetyUnblock}
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.safetyUnblock}
        message={dictionary.safetyUnblockMessage}
        onCancel={() => setPending(null)}
        onConfirm={unblock}
        open={pending !== null}
        title={formatMessage(dictionary.safetyUnblockTitle, { name: pending ? nameOf(pending) : '' })}
      />
    </SettingsPage>
  );
}
