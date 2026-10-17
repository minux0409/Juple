'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { isSessionLost } from '../../../../lib/authSession';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../../lib/paging';
import { collectionHref, isSafeHttpUrl } from '../../../../lib/savedLinks';
import { formatMessage, type AppDictionary } from '../../../../lib/appI18n';
import { isCollectionLocked, type CollectionSummary } from '../../../../lib/collectionsView';
import {
  FRIEND_NOTE_MAX_STORAGE_LENGTH,
  friendRequestFailure,
  lookupFailure,
  normalizeTypedJupleId,
  type Friend,
  type FriendRequest,
  type JupleIdLookup,
} from '../../../../lib/settings';
import { ApiHttpError } from '../../../../lib/appApi';
import { useSignedInApp } from '../../AppRoot';
import { useSafety } from '../../SafetyProvider';
import { ConfirmDialog } from '../../ConfirmDialog';
import { LoadMore } from '../../InfiniteScroll';
import { LoadFailed } from '../../PageStates';
import { SettingsRowSkeleton } from '../../Skeletons';
import { Avatar } from '../../Avatar';
import { Glyph } from '../../Glyph';
import { CollectionTileView } from '../../collections/CollectionsView';
import { BlockedUsersPanel } from '../blocked-users/BlockedUsers';
import { TOUR_TARGETS, tourTarget } from '../../../../lib/tour';
import { SearchField } from '../../SearchField';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

type Tab = 'friends' | 'incoming' | 'outgoing' | 'blocked';
type FriendsState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<Friend>);
type Confirm = { readonly kind: 'remove'; readonly friend: Friend } | { readonly kind: 'decline'; readonly request: FriendRequest } | null;

function personName(person: { readonly jupleId: string; readonly displayName: string | null }): string {
  return person.displayName?.trim() || formatJupleId(person.jupleId);
}

function friendsPath(query: string, cursor: string | null): string {
  const params = new URLSearchParams({ limit: '30' });
  if (query) {
    params.set('query', query);
  }
  if (cursor) {
    params.set('cursor', cursor);
  }
  return `/api/v1/friends?${params.toString()}`;
}

/**
 * 친구 - the mobile Friends screen: a personal address book of other Juple users by exact Juple ID and mutual consent (a friendship
 * grants no access to anything). The friend list (searchable within my own friends only - never a directory), requests received and
 * sent, adding by Juple ID, and my private note per friend (never shown to anyone else).
 */
export default function FriendsPage() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  // `?tab=blocked` (the old 차단한 사용자 address redirects there) opens the 차단한 사용자 tab.
  const [tab, setTab] = useState<Tab>(useSearchParams().get('tab') === 'blocked' ? 'blocked' : 'friends');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [friends, setFriends] = useState<FriendsState>({ kind: 'loading' });
  const [requests, setRequests] = useState<readonly FriendRequest[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [message, setMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);

  // Searching waits for the typing to pause (one request, not one per keystroke - mobile).
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fail = (caught: unknown): boolean => {
    if (isSessionLost(caught)) {
      onSessionLost();
      return true;
    }
    return false;
  };

  useEffect(() => {
    let ignore = false;
    api<{ readonly items: readonly Friend[]; readonly nextCursor: string | null }>({ path: friendsPath(debounced, null) }).then(
      page => {
        if (!ignore) {
          setFriends({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
        }
      },
      caught => {
        if (!ignore && !fail(caught)) {
          setFriends({ kind: 'failed' });
        }
      },
    );
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, debounced, reloadToken]);

  useEffect(() => {
    let ignore = false;
    api<{ readonly items: readonly FriendRequest[] }>({ path: '/api/v1/friends/requests' }).then(
      result => {
        if (!ignore) {
          setRequests(result.items);
        }
      },
      caught => {
        if (!ignore && !fail(caught)) {
          setRequestsFailed(true);
        }
      },
    );
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, reloadToken]);

  const loadMore = () => {
    if (friends.kind !== 'loaded' || !canLoadMore(friends)) {
      return;
    }
    const cursor = friends.nextCursor;
    setFriends({ kind: 'loaded', ...startLoadingMore(friends) });
    api<{ readonly items: readonly Friend[]; readonly nextCursor: string | null }>({ path: friendsPath(debounced, cursor) }).then(
      page => setFriends(current => (current.kind === 'loaded' ? { kind: 'loaded', ...appendPage(current, page, friend => friend.friendshipId) } : current)),
      caught => {
        if (!fail(caught)) {
          setFriends(current => (current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current));
        }
      },
    );
  };

  const act = <T,>(request: Promise<T>, onDone: (result: T) => void, intent: 'answer' | 'cancel' | 'send', success?: string) => {
    setBusy(true);
    setMessage(null);
    request.then(
      result => {
        onDone(result);
        setBusy(false);
        setConfirm(null);
        if (success) {
          setMessage({ text: success, error: false });
        }
      },
      caught => {
        setBusy(false);
        setConfirm(null);
        if (!fail(caught)) {
          setMessage({ text: friendRequestFailure(caught, dictionary, intent), error: true });
          // A request that is no longer open: the list is refreshed to what the server has.
          setReloadToken(token => token + 1);
        }
      },
    );
  };

  const incoming = (requests ?? []).filter(request => request.direction === 'incoming');
  const outgoing = (requests ?? []).filter(request => request.direction === 'outgoing');
  const removeRequest = (requestId: number) => setRequests(previous => (previous ?? []).filter(request => request.requestId !== requestId));

  return (
    <SettingsPage backHref={null} icon="People" title={dictionary.friendsTitle} width="medium">
      <AddFriend
        friends={friends.kind === 'loaded' ? friends.items : []}
        onSent={request => {
          setRequests(previous => [request, ...(previous ?? [])]);
          setTab('outgoing');
        }}
        requests={requests ?? []}
        onShowIncoming={() => setTab('incoming')}
      />
      {message ? (
        <p className={message.error ? styles.fieldError : styles.formNotice} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
      <div className={styles.filterTabs} role="tablist" {...tourTarget(TOUR_TARGETS.friendsTabs)}>
        {(
          [
            ['friends', dictionary.friendsTitle, null],
            ['incoming', dictionary.friendsTabIncoming, incoming.length],
            ['outgoing', dictionary.friendsTabOutgoing, outgoing.length],
            ['blocked', dictionary.safetyBlockedUsers, null],
          ] as const
        ).map(([key, label, count]) => (
          <button aria-selected={tab === key} className={tab === key ? styles.filterTabSelected : styles.filterTab} key={key} onClick={() => setTab(key)} role="tab" type="button">
            {label}
            {count ? <span className={styles.countPill}>{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'friends' ? (
        <>
          <SearchField onChange={setQuery} placeholder={dictionary.friendsSearch} value={query} />
          {friends.kind === 'loading' ? <SettingsRowSkeleton count={4} /> : null}
          {friends.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={() => setReloadToken(token => token + 1)} /> : null}
          {friends.kind === 'loaded' && friends.items.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.stateTitle}>{debounced ? dictionary.friendsSearchEmpty : dictionary.friendsEmpty}</p>
              {debounced ? null : <p className={styles.stateMessage}>{dictionary.friendsEmptyHint}</p>}
            </div>
          ) : null}
          {friends.kind === 'loaded' && friends.items.length > 0 ? (
            <>
              <ul className={styles.friendCards}>
                {friends.items.map(friend => (
                  <FriendRow
                    busy={busy}
                    friend={friend}
                    key={friend.friendshipId}
                    onBlocked={() => setReloadToken(token => token + 1)}
                    onRemove={() => setConfirm({ kind: 'remove', friend })}
                    onUpdated={updated =>
                      setFriends(current => (current.kind === 'loaded' ? { ...current, items: current.items.map(item => (item.friendshipId === updated.friendshipId ? updated : item)) } : current))
                    }
                  />
                ))}
              </ul>
              <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SettingsRowSkeleton count={2} />} state={friends} />
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'blocked' ? <BlockedUsersPanel /> : null}

      {tab === 'incoming' || tab === 'outgoing' ? (
        <>
          {requests === null && !requestsFailed ? <SettingsRowSkeleton count={3} /> : null}
          {requestsFailed ? <LoadFailed dictionary={dictionary} onRetry={() => setReloadToken(token => token + 1)} /> : null}
          {requests !== null && (tab === 'incoming' ? incoming : outgoing).length === 0 ? (
            <p className={styles.emptyState}>{tab === 'incoming' ? dictionary.friendsIncomingEmpty : dictionary.friendsOutgoingEmpty}</p>
          ) : null}
          {requests !== null && (tab === 'incoming' ? incoming : outgoing).length > 0 ? (
            <ul className={styles.friendCards}>
              {(tab === 'incoming' ? incoming : outgoing).map(request => (
                <li className={styles.friendCard} key={request.requestId}>
                  <div className={styles.friendCardMain}>
                  <Avatar person={{ displayName: request.displayName, profileImageUrl: null }} size={48} />
                  <span className={styles.friendIdentity}>
                    <span className={styles.friendName} dir="auto">
                      {personName(request)}
                    </span>
                    <span className={styles.profileId} dir="ltr">
                      @{formatJupleId(request.jupleId)}
                    </span>
                  </span>
                  <span className={styles.friendActions}>
                    {request.direction === 'incoming' ? (
                      <>
                        <button
                          className={styles.primaryAction}
                          disabled={busy}
                          onClick={() =>
                            act(
                              api<Friend>({ method: 'POST', path: `/api/v1/friends/requests/${request.requestId}/accept` }),
                              friend => {
                                removeRequest(request.requestId);
                                setFriends(current => (current.kind === 'loaded' ? { ...current, items: [friend, ...current.items.filter(item => item.friendshipId !== friend.friendshipId)] } : current));
                              },
                              'answer',
                            )
                          }
                          type="button"
                        >
                          {dictionary.accept}
                        </button>
                        <button className={styles.settingsAction} disabled={busy} onClick={() => setConfirm({ kind: 'decline', request })} type="button">
                          {dictionary.decline}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className={styles.settingsSubValue}>{dictionary.friendsRequestPending}</span>
                        <button
                          className={styles.settingsAction}
                          disabled={busy}
                          onClick={() => act(api<void>({ method: 'DELETE', path: `/api/v1/friends/requests/${request.requestId}` }), () => removeRequest(request.requestId), 'cancel')}
                          type="button"
                        >
                          {dictionary.cancel}
                        </button>
                      </>
                    )}
                  </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={confirm?.kind === 'remove' ? dictionary.friendsRemove : dictionary.decline}
        destructive
        message={confirm?.kind === 'remove' ? dictionary.friendsRemoveConfirmMessage : dictionary.friendsDeclineConfirmMessage}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'remove') {
            const target = confirm.friend;
            act(api<void>({ method: 'DELETE', path: `/api/v1/friends/${target.friendshipId}` }), () =>
              setFriends(current => (current.kind === 'loaded' ? { ...current, items: current.items.filter(item => item.friendshipId !== target.friendshipId) } : current)), 'answer');
          } else if (confirm?.kind === 'decline') {
            const target = confirm.request;
            act(api<void>({ method: 'POST', path: `/api/v1/friends/requests/${target.requestId}/decline` }), () => removeRequest(target.requestId), 'answer');
          }
        }}
        open={confirm !== null}
        title={confirm?.kind === 'remove' ? dictionary.friendsRemoveConfirmTitle : dictionary.friendsDeclineConfirmTitle}
      />
    </SettingsPage>
  );
}

/** One friend: name, Juple ID, my private note (edited in place), and 친구 삭제. */
function FriendRow({ friend, busy, onRemove, onUpdated, onBlocked }: { readonly friend: Friend; readonly busy: boolean; readonly onRemove: () => void; readonly onUpdated: (friend: Friend) => void; readonly onBlocked: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const safety = useSafety();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(friend.myNote ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = isSafeHttpUrl(friend.profileImageUrl) ? friend.profileImageUrl : null;

  const saveNote = (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    api<Friend>({ method: 'PUT', path: `/api/v1/friends/${friend.friendshipId}/note`, body: { note } }).then(
      updated => {
        setSaving(false);
        setEditing(false);
        onUpdated(updated);
      },
      caught => {
        setSaving(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(caught instanceof ApiHttpError && caught.status === 400 ? dictionary.friendsNoteInvalid : dictionary.friendsActionFallback);
      },
    );
  };

  return (
    <li className={styles.friendCard}>
      <div className={styles.friendCardMain}>
        <Avatar person={{ displayName: friend.displayName, profileImageUrl: photo }} size={48} />
        <span className={styles.friendIdentity}>
          <span className={styles.friendName} dir="auto">
            {personName(friend)}
          </span>
          <span className={styles.profileId} dir="ltr">
            @{formatJupleId(friend.jupleId)}
          </span>
          {!editing && friend.myNote ? (
            <span className={styles.friendNoteLine} data-friend-note dir="auto" title={friend.myNote}>
              {friend.myNote}
            </span>
          ) : null}
        </span>
        <span className={styles.friendActions}>
          <button className={styles.settingsAction} disabled={busy || saving} onClick={() => setEditing(value => !value)} type="button">
            <Glyph name="Edit" size={16} />
            {dictionary.friendsNote}
          </button>
          {/* Each action: a meaningful icon AND its word (the icon never replaces the label) - 메모 neutral, 신고 warning, 차단 / 친구 삭제 destructive. */}
          <button className={`${styles.settingsAction} ${styles.warningAction}`} data-friend-report disabled={busy} onClick={() => safety.report({ type: 'User', jupleId: friend.jupleId })} type="button">
            <Glyph name="Flag" size={16} />
            {dictionary.safetyReport}
          </button>
          <button className={styles.dangerAction} data-friend-block disabled={busy} onClick={() => safety.block({ jupleId: friend.jupleId, name: personName(friend) }, onBlocked)} type="button">
            <Glyph name="Block" size={16} />
            {dictionary.safetyBlock}
          </button>
          <button className={styles.dangerAction} data-friend-remove disabled={busy} onClick={onRemove} type="button">
            <Glyph name="UserMinus" size={16} />
            {dictionary.friendsRemove}
          </button>
        </span>
      </div>
      <SharedCollections dictionary={dictionary} friendshipId={friend.friendshipId} />
      {editing ? (
        <form className={styles.friendNoteForm} noValidate onSubmit={saveNote}>
          <input
            aria-label={dictionary.friendsNote}
            className={styles.textInput}
            dir="auto"
            maxLength={FRIEND_NOTE_MAX_STORAGE_LENGTH}
            onChange={event => setNote(event.target.value)}
            value={note}
          />
          <button className={styles.primaryAction} disabled={saving} type="submit">
            {saving ? dictionary.saving : dictionary.friendsSaveNote}
          </button>
          {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
        </form>
      ) : null}
    </li>
  );
}

type SharedState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'loaded'; readonly items: readonly CollectionSummary[]; readonly nextCursor: string | null; readonly loadingMore: boolean; readonly moreFailed: boolean };

/**
 * 함께 공유 중인 컬렉션: the Collections this friend and I both take part in (Owner or member - the server decides, memberships only; a
 * public link alone shares nothing). Closed until asked: a friends list does not fetch (or render) a list of Collections per card; the
 * first opening reads one page of this friend's own, and each Collection opens its page like any other. The friend's identity is the
 * friendship id - the server answers a friendship that is not mine with 404 and an empty list across a block.
 */
function SharedCollections({ friendshipId, dictionary }: { readonly friendshipId: number; readonly dictionary: AppDictionary }) {
  const { api, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<SharedState>({ kind: 'closed' });

  const toggle = () => {
    if (state.kind !== 'closed') {
      setState({ kind: 'closed' });
      return;
    }
    setState({ kind: 'loading' });
    api<{ readonly items: readonly CollectionSummary[]; readonly nextCursor: string | null }>({ path: `/api/v1/friends/${friendshipId}/shared-collections?limit=50` }).then(
      page => setState({ kind: 'loaded', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreFailed: false }),
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setState({ kind: 'failed' });
      },
    );
  };

  // The next page by the server's own cursor: one request at a time; the rows already shown stay on a failure, and the button retries.
  const loadMore = () => {
    if (state.kind !== 'loaded' || state.nextCursor === null || state.loadingMore) {
      return;
    }
    const cursor = state.nextCursor;
    setState({ ...state, loadingMore: true, moreFailed: false });
    api<{ readonly items: readonly CollectionSummary[]; readonly nextCursor: string | null }>({
      path: `/api/v1/friends/${friendshipId}/shared-collections?limit=50&cursor=${encodeURIComponent(cursor)}`,
    }).then(
      page =>
        setState(current =>
          current.kind === 'loaded'
            ? {
                kind: 'loaded',
                items: [...current.items, ...page.items.filter(entry => !current.items.some(known => known.id === entry.id))],
                nextCursor: page.nextCursor,
                loadingMore: false,
                moreFailed: false,
              }
            : current,
        ),
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setState(current => (current.kind === 'loaded' ? { ...current, loadingMore: false, moreFailed: true } : current));
      },
    );
  };

  const open = state.kind !== 'closed';
  const title = state.kind === 'loaded' ? formatMessage(dictionary.friendsSharedCollectionsCount, { count: `${state.items.length}${state.nextCursor !== null ? '+' : ''}` }) : dictionary.friendsSharedCollectionsTitle;
  return (
    <div className={styles.friendShared} data-friend-shared>
      <button aria-expanded={open} className={styles.friendSharedToggle} onClick={toggle} type="button">
        <Glyph name="Folder" size={16} />
        <span>{title}</span>
        <span aria-hidden className={open ? styles.sectionChevronOpen : styles.sectionChevron}>
          <Glyph name="Chevron" size={16} />
        </span>
      </button>
      {state.kind === 'loading' ? <SettingsRowSkeleton count={1} /> : null}
      {state.kind === 'failed' ? <p className={styles.fieldError} role="alert">{dictionary.friendsSharedCollectionsFailed}</p> : null}
      {state.kind === 'loaded' && state.items.length === 0 ? <p className={styles.settingsSubValue}>{dictionary.friendsSharedCollectionsEmpty}</p> : null}
      {state.kind === 'loaded' && state.items.length > 0 ? (
        <ul className={styles.friendSharedList}>
          {state.items.map(collection => (
            <li key={collection.id}>
              <Link className={styles.friendSharedItem} href={collectionHref(collection.id)}>
                <CollectionTileView collection={collection} size={36} />
                <span className={styles.friendSharedName} dir="auto">
                  {collection.name}
                </span>
                {isCollectionLocked(collection) ? (
                  <span aria-label={dictionary.lockedCollection} className={styles.badge} role="img" title={dictionary.lockedCollection}>
                    <Glyph name="Lock" size={13} />
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {state.kind === 'loaded' && state.nextCursor !== null ? (
        <>
          {state.moreFailed ? <p className={styles.fieldError} role="alert">{dictionary.friendsSharedCollectionsFailed}</p> : null}
          <button className={styles.friendSharedMore} data-friend-shared-more disabled={state.loadingMore} onClick={loadMore} type="button">
            {state.loadingMore ? dictionary.processing : state.moreFailed ? dictionary.retry : dictionary.friendsSharedCollectionsMore}
          </button>
        </>
      ) : null}
    </div>
  );
}

/** 친구 추가 (mobile AddFriendModal): find one exact Juple ID, see who it is and what they already are to me, then send a request. */
function AddFriend({
  friends,
  requests,
  onSent,
  onShowIncoming,
}: {
  readonly friends: readonly Friend[];
  readonly requests: readonly FriendRequest[];
  readonly onSent: (request: FriendRequest) => void;
  readonly onShowIncoming: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [typed, setTyped] = useState('');
  const [found, setFound] = useState<JupleIdLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const find = (event: React.FormEvent) => {
    event.preventDefault();
    const jupleId = normalizeTypedJupleId(typed);
    if (!jupleId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setFound(null);
    setSent(false);
    api<JupleIdLookup>({ method: 'POST', path: '/api/v1/users/lookup-by-juple-id', body: { jupleId } }).then(
      result => {
        setBusy(false);
        setFound(result);
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(lookupFailure(caught, dictionary));
      },
    );
  };

  // What the found person already is to me - only from what is known (mobile FoundRelationship); the server decides on send.
  const relationship = !found
    ? null
    : found.isSelf
      ? 'self'
      : requests.some(request => request.jupleId === found.jupleId && request.direction === 'incoming')
        ? 'incoming'
        : requests.some(request => request.jupleId === found.jupleId && request.direction === 'outgoing')
          ? 'pending'
          : friends.some(friend => friend.jupleId === found.jupleId)
            ? 'friend'
            : 'available';

  const send = () => {
    if (!found || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    api<FriendRequest>({ method: 'POST', path: '/api/v1/friends/requests', body: { jupleId: found.jupleId } }).then(
      request => {
        setBusy(false);
        setSent(true);
        onSent(request);
      },
      caught => {
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setError(friendRequestFailure(caught, dictionary, 'send'));
      },
    );
  };

  return (
    <div className={styles.settingsCard}>
      <form className={styles.inlineForm} noValidate onSubmit={find}>
        <input
          aria-label={dictionary.friendsJupleIdPlaceholder}
          autoComplete="off"
          className={styles.textInput}
          dir="ltr"
          onChange={event => {
            setTyped(event.target.value);
            setFound(null);
            setError(null);
            setSent(false);
          }}
          placeholder={dictionary.friendsJupleIdPlaceholder}
          value={typed}
        />
        <button className={styles.settingsAction} disabled={!typed.trim() || busy} type="submit">
          {dictionary.find}
        </button>
      </form>
      {!found && !error ? <p className={styles.settingsNote}>{dictionary.friendsLookupHint}</p> : null}
      {error ? <p className={styles.formError} role="alert">{error}</p> : null}
      {found ? (
        <div className={styles.settingsRow} data-lookup-result>
          <Avatar person={{ displayName: found.displayName, profileImageUrl: found.profileImageUrl ?? null }} size={44} />
          <span className={styles.personText}>
            <span className={styles.settingsValueStart} dir="auto">
              {found.isSelf ? dictionary.friendsYou : personName({ jupleId: found.jupleId, displayName: found.displayName })}
            </span>
            <span className={styles.profileId} dir="ltr">
              @{formatJupleId(found.jupleId)}
            </span>
          </span>
          <span className={styles.rowActions}>
            {sent ? <span className={styles.settingsSubValue}>{dictionary.friendsRequestSent}</span> : null}
            {!sent && relationship === 'available' ? (
              <button className={styles.primaryAction} disabled={busy} onClick={send} type="button">
                {dictionary.friendsSendRequest}
              </button>
            ) : null}
            {!sent && relationship === 'friend' ? <span className={styles.settingsSubValue}>{dictionary.friendsAlreadyFriends}</span> : null}
            {!sent && relationship === 'pending' ? <span className={styles.settingsSubValue}>{dictionary.friendsRequestPending}</span> : null}
            {!sent && relationship === 'incoming' ? (
              <button className={styles.linkButton} onClick={onShowIncoming} type="button">
                {dictionary.friendsViewIncoming}
              </button>
            ) : null}
            {relationship === 'self' ? <span className={styles.settingsSubValue}>{dictionary.friendsCannotAddSelf}</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
