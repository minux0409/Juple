'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { isSessionLost } from '../../../../lib/authSession';
import { BLOCKED_USERS_PATH, blockPath, parseBlockedUsers, type BlockedUser } from '../../../../lib/safety';
import { isSafeHttpUrl } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { Avatar } from '../../Avatar';
import { LoadFailed } from '../../PageStates';
import { SettingsRowSkeleton } from '../../Skeletons';
import { useToast } from '../../Toaster';
import styles from '../../app.module.css';

type State = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly items: readonly BlockedUser[] };

/**
 * 차단한 사용자, a tab of 친구 (mobile FriendsScreen's 차단한 사용자 tab): who this person blocked - their nickname, Juple ID and photo -
 * and 차단 해제 for each. Unblocking does not make anyone a friend again. Only the caller's own list is ever shown (never the people
 * who blocked them), and never why or by whom. It is mounted only while its tab is open, so it always shows the server's current list.
 */
export function BlockedUsersPanel() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let ignore = false;
    api<unknown>({ path: BLOCKED_USERS_PATH }).then(
      raw => {
        if (!ignore) {
          setState({ kind: 'loaded', items: parseBlockedUsers(raw) });
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reload]);

  const unblock = useCallback(
    (user: BlockedUser) => {
      if (busyId) {
        return;
      }
      setBusyId(user.jupleId);
      api<void>({ method: 'DELETE', path: blockPath(user.jupleId) }).then(
        () => {
          setBusyId(null);
          setState(current => (current.kind === 'loaded' ? { kind: 'loaded', items: current.items.filter(item => item.jupleId !== user.jupleId) } : current));
          toast.showNotice(dictionary.safetyUnblockedDone);
        },
        caught => {
          setBusyId(null);
          if (isSessionLost(caught)) {
            onSessionLost();
            return;
          }
          toast.showNotice(dictionary.safetyBlockFailed, 'error');
        },
      );
    },
    [api, busyId, dictionary.safetyBlockFailed, dictionary.safetyUnblockedDone, onSessionLost, toast],
  );

  return (
    <div aria-label={dictionary.safetyBlockedUsers} data-blocked-users role="tabpanel">
      {state.kind === 'loading' ? <SettingsRowSkeleton count={3} /> : null}
      {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={() => { setState({ kind: 'loading' }); setReload(value => value + 1); }} /> : null}
      {state.kind === 'loaded' && state.items.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.stateTitle}>{dictionary.safetyBlockedUsersEmpty}</p>
        </div>
      ) : null}
      {state.kind === 'loaded' && state.items.length > 0 ? (
        <ul className={styles.friendCards}>
          {state.items.map(user => (
            <li className={styles.friendCard} data-blocked-user key={user.jupleId}>
              <div className={styles.friendCardMain}>
                <Avatar person={{ displayName: user.displayName, profileImageUrl: isSafeHttpUrl(user.profileImageUrl) ? user.profileImageUrl : null }} size={48} />
                <span className={styles.friendIdentity}>
                  <span className={styles.friendName} dir="auto">
                    {user.displayName ?? `@${formatJupleId(user.jupleId)}`}
                  </span>
                  <span className={styles.profileId} dir="ltr">
                    @{formatJupleId(user.jupleId)}
                  </span>
                </span>
                <span className={styles.friendActions}>
                  <button className={styles.settingsAction} data-unblock disabled={busyId !== null} onClick={() => unblock(user)} type="button">
                    {dictionary.safetyUnblock}
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
