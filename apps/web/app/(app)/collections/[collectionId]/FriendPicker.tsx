'use client';

import { useEffect, useRef, useState } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { formatMessage } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { unlockHeaders } from '../../../../lib/collectionUnlock';
import {
  FRIEND_PICKER_DEBOUNCE_MS,
  INVITE_ROLES,
  friendPickerPath,
  inviteErrorMessage,
  inviteRoleLabel,
  invitationsPath,
  type FriendUnavailableReason,
  type InviteRole,
} from '../../../../lib/collectionInvite';
import { INVITATION_ROLE_RANK, raiseToMinimum } from '../../../../lib/collectionShareManage';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../../lib/paging';
import type { Friend } from '../../../../lib/settings';
import { isSafeHttpUrl } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { Avatar } from '../../Avatar';
import { LoadMore } from '../../InfiniteScroll';
import { ModalCloseButton } from '../../ModalCloseButton';
import { SearchField } from '../../SearchField';
import { SettingsRowSkeleton } from '../../Skeletons';
import { ViewModeToggle } from '../../ViewModeToggle';
import styles from '../../app.module.css';

const FRIEND_PICKER_VIEW_MODES = ['list', 'grid'] as const;

type ListState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<Friend>);

function personName(person: { readonly jupleId: string; readonly displayName: string | null }): string {
  return person.displayName?.trim() || formatJupleId(person.jupleId);
}

/**
 * 친구에서 선택 (mobile FriendPickerModal): a large rounded dialog with a search, the friends as one list with a check circle each
 * (Juple Blue when picked), what they may do, and [취소] [N명 추가]. Friends already in the Collection or already invited are shown
 * and cannot be picked. Each pick is its own invitation; one that fails is named and stays picked, the rest went through.
 */
export function FriendPicker({
  open,
  collectionId,
  unavailable,
  minimumRole = null,
  referral = false,
  onClose,
  onInvited,
}: {
  readonly open: boolean;
  readonly referral?: boolean;
  readonly collectionId: number;
  readonly unavailable: ReadonlyMap<string, FriendUnavailableReason>;
  /** While the Collection is public, nobody may be invited below the link's level (mobile): lower roles are not offered. */
  readonly minimumRole?: InviteRole | null;
  readonly onClose: () => void;
  /** At least one invitation was sent: the caller reads the participants again. */
  readonly onInvited: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  // List | Grid is a way of looking at the same friends (in memory for this opening; the order and the search are unchanged).
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [picked, setPicked] = useState<ReadonlyMap<string, Friend>>(new Map());
  const [chosenRole, setRole] = useState<InviteRole>('contributor');
  const role = raiseToMinimum(chosenRole, minimumRole);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [failures, setFailures] = useState<readonly string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text), text ? FRIEND_PICKER_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    let ignore = false;
    api<{ readonly items: readonly Friend[]; readonly nextCursor: string | null }>({ path: friendPickerPath(query, null) }).then(
      page => {
        if (!ignore) {
          setList({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
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
        setList({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, open, query, reloadToken]);

  const close = () => {
    if (busy) {
      return;
    }
    setText('');
    setPicked(new Map());
    setFailures([]);
    onClose();
  };

  const toggle = (friend: Friend) => {
    if (unavailable.has(friend.jupleId) || busy || (referral && !picked.has(friend.jupleId) && picked.size >= 20)) {
      return;
    }
    setPicked(previous => {
      const next = new Map(previous);
      if (next.has(friend.jupleId)) {
        next.delete(friend.jupleId);
      } else if (!referral || previous.size < 20) {
        next.set(friend.jupleId, friend);
      }
      return next;
    });
  };

  const loadMore = () => {
    if (list.kind !== 'loaded' || !canLoadMore(list)) {
      return;
    }
    const cursor = list.nextCursor;
    setList({ kind: 'loaded', ...startLoadingMore(list) });
    api<{ readonly items: readonly Friend[]; readonly nextCursor: string | null }>({ path: friendPickerPath(query, cursor) }).then(
      page => setList(current => (current.kind === 'loaded' ? { kind: 'loaded', ...appendPage(current, page, friend => Number(friend.friendshipId)) } : current)),
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setList(current => (current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current));
      },
    );
  };

  const confirm = async () => {
    if (inFlight.current || busy || picked.size === 0) {
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setFailures([]);
    const failed: string[] = [];
    const remaining = new Map(picked);
    let sent = 0;
    if (referral) {
      // One bounded request, not N concurrent invitation calls. Successful recipients leave the selection.
      const batch = [...picked.values()].slice(0, 20);
      try {
        const result = await api<{ sent: string[]; skipped?: string[]; notFound: string[] }>({
          method: 'POST', path: `/api/v1/collections/${collectionId}/share/link/send`,
          body: { jupleIds: batch.map(friend => friend.jupleId) }, headers: unlockHeaders(collectionId),
        });
        for (const friend of batch) {
          if (result.sent.includes(friend.jupleId)) { remaining.delete(friend.jupleId); sent++; }
          else failed.push(`${personName(friend)}: ${result.skipped?.includes(friend.jupleId) ? dictionary.inviteAlreadyPending : dictionary.inviteFallback}`);
        }
      } catch (caught) {
        if (isSessionLost(caught)) onSessionLost();
        failed.push(inviteErrorMessage(caught, dictionary));
      }
      if (picked.size > 20) failed.push(dictionary.tooManyRequests);
    } else {
    for (const friend of picked.values()) {
      try {
        await api<unknown>({ method: 'POST', path: invitationsPath(collectionId), body: { jupleId: friend.jupleId, role }, headers: unlockHeaders(collectionId) });
        remaining.delete(friend.jupleId);
        sent += 1;
      } catch (caught) {
        if (isSessionLost(caught)) {
          inFlight.current = false; setBusy(false);
          onSessionLost();
          return;
        }
        failed.push(`${personName(friend)}: ${inviteErrorMessage(caught, dictionary)}`);
      }
    }
    }
    inFlight.current = false;
    setBusy(false);
    setPicked(remaining);
    setFailures(failed);
    if (sent > 0) {
      onInvited();
    }
    if (failed.length === 0) {
      setText('');
      onClose();
    }
  };

  return (
    <dialog
      aria-labelledby="friend-picker-title"
      className={styles.friendPickerDialog}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      ref={ref}
    >
      <div className={styles.friendPickerHeader}>
        <h2 className={styles.dialogTitle} id="friend-picker-title">
          {dictionary.chooseFriends}
        </h2>
        <ModalCloseButton label={dictionary.close} onClick={close} />
      </div>
      <div className={styles.friendPickerSearchRow}>
        <SearchField onChange={setText} placeholder={dictionary.friendsSearch} value={text} />
        <ViewModeToggle
          groupLabel={dictionary.viewModeLabel}
          labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
          modes={FRIEND_PICKER_VIEW_MODES}
          onChange={setLayout}
          value={layout}
        />
      </div>
      {!referral ? <div className={styles.friendPickerPermission}>
        <span className={styles.fieldLabel}>{dictionary.sharePermissionLabel}</span>
        <div aria-label={dictionary.sharePermissionLabel} className={styles.filterTabs} role="group">
          {INVITE_ROLES.map(option => (
            <button
              aria-pressed={role === option}
              className={role === option ? styles.filterTabSelected : styles.filterTab}
              disabled={minimumRole !== null && INVITATION_ROLE_RANK[option] < INVITATION_ROLE_RANK[minimumRole]}
              key={option}
              onClick={() => setRole(option)}
              type="button"
            >
              {inviteRoleLabel(option, dictionary)}
            </button>
          ))}
        </div>
      </div> : null}
      <div className={styles.friendPickList}>
        {list.kind === 'loading' ? <SettingsRowSkeleton count={3} /> : null}
        {list.kind === 'failed' ? (
          <p className={styles.fieldError}>
            {dictionary.loadFailedTitle}{' '}
            <button className={styles.linkButton} onClick={() => setReloadToken(token => token + 1)} type="button">
              {dictionary.retry}
            </button>
          </p>
        ) : null}
        {list.kind === 'loaded' && list.items.length === 0 ? <p className={styles.stateMessage}>{query ? dictionary.friendsSearchEmpty : dictionary.friendsEmpty}</p> : null}
        {list.kind === 'loaded' ? (
          <ul className={layout === 'grid' ? styles.friendPickGrid : styles.personList} data-friend-picker-layout={layout}>
            {list.items.map(friend => {
              const isPicked = picked.has(friend.jupleId);
              const blocked = unavailable.has(friend.jupleId);
              return (
                <li key={friend.jupleId}>
                  <button
                    aria-pressed={isPicked}
                    className={layout === 'grid' ? (isPicked ? styles.friendPickTileSelected : styles.friendPickTile) : isPicked ? styles.friendPickRowSelected : styles.friendPickRow}
                    disabled={blocked || busy || (referral && !isPicked && picked.size >= 20)}
                    onClick={() => toggle(friend)}
                    type="button"
                  >
                    <span aria-hidden className={isPicked ? styles.pickMarkSelected : styles.pickMark}>
                      {isPicked ? '✓' : ''}
                    </span>
                    <Avatar person={{ displayName: friend.displayName, profileImageUrl: isSafeHttpUrl(friend.profileImageUrl) ? friend.profileImageUrl : null }} size={layout === 'grid' ? 56 : 40} />
                    <span className={layout === 'grid' ? styles.friendPickTileText : styles.personText}>
                      <span className={styles.settingsValueStart} dir="auto">
                        {personName(friend)}
                      </span>
                      <span className={styles.profileId} dir="ltr">
                        @{formatJupleId(friend.jupleId)}
                      </span>
                    </span>
                    {blocked ? <span className={styles.roleBadge}>{unavailable.get(friend.jupleId) === 'member' ? dictionary.participantsTitle : dictionary.participantsPendingStatus}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {list.kind === 'loaded' ? <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SettingsRowSkeleton count={2} />} state={list} /> : null}
      </div>
      {failures.length > 0 ? (
        <div className={styles.fieldError} role="alert">
          {failures.map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      <div className={styles.friendPickerFooter}>
        <span className={styles.searchHint}>{picked.size > 0 ? formatMessage(dictionary.selectedCount, { count: picked.size }) : ''}</span>
        <div className={styles.formActions}>
          <button className={styles.settingsAction} disabled={busy} onClick={close} type="button">
            {dictionary.cancel}
          </button>
          <button className={styles.primaryAction} disabled={busy || picked.size === 0} onClick={() => void confirm()} type="button">
            {busy ? dictionary.processing : formatMessage(dictionary.addSelectedFriends, { count: picked.size })}
          </button>
        </div>
      </div>
    </dialog>
  );
}
