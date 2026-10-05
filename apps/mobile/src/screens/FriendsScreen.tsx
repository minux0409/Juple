import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { formatBadgeCount } from '../components/badgeCount';
import { LoadFailureState } from '../components/LoadFailureState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useMessageDialog } from '../components/useMessageDialog';
import { savedLinkLayout } from '../components/savedLinkLayout';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference, type ViewMode } from '../settings/viewModePreference';
import { UserAvatar } from '../components/UserAvatar';
import { AddFriendModal, getFriendRequestErrorMessage } from '../friends/AddFriendModal';
import { FriendDetailModal } from '../friends/FriendDetailModal';
import { usePersonProfile } from '../friends/PersonProfileModal';
import { formatJupleId } from '../collections/api/collaborationApi';
import { getFriendSearchEmptyState } from '../friends/friendSearchEmptyState';
import { atJupleId, friendPrimaryLabel } from '../friends/friendIdentity';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getFriendRequests,
  getFriends,
  removeFriend,
  type Friend,
  type FriendRequest,
} from '../friends/api/friendsApi';
import { CopyIcon } from '../icons/CopyIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UserIcon } from '../icons/UserIcon';
import { ensurePushPermissionOnce } from '../push/pushPermissionFlow';
import { useFocusedPolling, useLiveRefresh } from '../push/useLiveRefresh';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;
/** One line of a friend's memo (12pt text) - reserved even when empty, scaled by the system font scale. */
const NOTE_LINE_HEIGHT = 16;
const ID_LINE_HEIGHT = 16;
/** The gap between two friend cards (List): the compact repeated-item gap, smaller than the controls' gap above the first card. */
const FRIEND_CARD_GAP = spacing.sm;
/** While a sent friend request is waiting (Friends screen open, app in the foreground). */
export const OUTGOING_POLL_INTERVAL_MS = 10_000;
/** Per visit - after that, Push / focus / returning to the app refresh it. */
export const OUTGOING_POLL_MAX_MS = 10 * 60_000;

export type FriendsTab = 'friends' | 'incoming' | 'outgoing';

/**
 * 친구: an address book of Juple users added by exact Juple ID and mutual consent. Being friends
 * grants nothing - it only makes people easy to find again (e.g. when inviting to a Category).
 *
 * Three tabs over one screen - 친구 | 받은 요청 | 보낸 요청 - with 친구 추가 as the header's [+]. Each
 * tab keeps what it already loaded: switching tabs never reloads or blanks anything. The data is
 * refreshed on focus, pull-to-refresh, a friend Push, a sent request's short re-check, and after
 * each action (only the part that action changed). An action busies only its own row.
 */
export function FriendsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const authenticatedRequest = useAuthenticatedApi();
  const [tab, setTab] = useState<FriendsTab>('friends');
  // The same List/Grid switch and persistence Home/History/Collections use.
  const { viewMode, changeViewMode } = useViewModePreference('friendsViewMode');

  const [friends, setFriends] = useState<readonly Friend[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasLoadedFriends, setHasLoadedFriends] = useState(false);
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [friendsError, setFriendsError] = useState(false);
  // What the last failed load threw - only to tell "no connection" from "the server failed" in the state shown.
  const [friendsFailure, setFriendsFailure] = useState<unknown>(null);
  const [search, setSearch] = useState('');
  const loadIdRef = useRef(0);

  const [requests, setRequests] = useState<readonly FriendRequest[]>([]);
  const [hasLoadedRequests, setHasLoadedRequests] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [requestsFailure, setRequestsFailure] = useState<unknown>(null);
  const [busyRequestIds, setBusyRequestIds] = useState<ReadonlySet<number>>(() => new Set());
  const busyRequestIdsRef = useRef<Set<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  // An operation's result (a request that is no longer open, ...) is a centered message, never an inline red line.
  const { showMessage, messageDialog } = useMessageDialog();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selected, setSelected] = useState<Friend | null>(null);
  // A long press (or the swipe) on a friend: the compact action popup, and the delete confirmation it leads to.
  const [menuFriend, setMenuFriend] = useState<Friend | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Friend | null>(null);
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const [isAddOpen, setIsAddOpen] = useState(false);
  // A request row's person (the whole identity area is the tap target): the same person/friend info as everywhere.
  const { openProfile, profileModal } = usePersonProfile();

  const openAdd = useCallback(() => setIsAddOpen(true), []);
  const renderHeaderRight = useCallback(() => <FriendsAddHeaderButton onPress={openAdd} />, [openAdd]);
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: renderHeaderRight });
  }, [navigation, renderHeaderRight]);

  const loadFriends = useCallback(
    async (query: string) => {
      const loadId = ++loadIdRef.current;
      setIsLoadingFriends(true);
      try {
        const page = await getFriends(authenticatedRequest, { query: query.trim() || undefined, limit: PAGE_LIMIT });
        if (loadId === loadIdRef.current) {
          setFriends(page.items);
          setNextCursor(page.nextCursor);
          setHasLoadedFriends(true);
          setFriendsError(false);
        }
      } catch (caughtError) {
        if (loadId === loadIdRef.current) {
          setFriendsError(true);
          setFriendsFailure(caughtError);
        }
      } finally {
        if (loadId === loadIdRef.current) {
          setIsLoadingFriends(false);
        }
      }
    },
    [authenticatedRequest],
  );

  const searchRef = useRef(search);
  searchRef.current = search;
  // Sent requests seen in the last load: one that is gone now was accepted, declined or
  // cancelled - the friend list is reloaded so an accepted one appears there at once.
  const outgoingIdsRef = useRef<ReadonlySet<number>>(new Set());

  const loadRequests = useCallback(async () => {
    try {
      const loaded = await getFriendRequests(authenticatedRequest);
      setRequests(loaded);
      setHasLoadedRequests(true);
      setRequestsError(false);
      const outgoingIds = new Set(loaded.filter(request => request.direction === 'outgoing').map(request => request.requestId));
      const anAnswered = [...outgoingIdsRef.current].some(id => !outgoingIds.has(id));
      outgoingIdsRef.current = outgoingIds;
      if (anAnswered) {
        loadFriends(searchRef.current);
      }
    } catch (caughtError) {
      setRequestsError(true);
      setRequestsFailure(caughtError);
    }
  }, [authenticatedRequest, loadFriends]);

  useFocusEffect(
    useCallback(() => {
      loadFriends(searchRef.current);
      loadRequests();
      ensurePushPermissionOnce(authenticatedRequest);
    }, [authenticatedRequest, loadFriends, loadRequests]),
  );

  // A friend request arriving - or one I sent being accepted/declined - shows up at once while this
  // screen is open (and on returning to the app): an answered request leaves 보낸 요청, and an
  // accepted one appears in the friend list (loadRequests notices the answered one and reloads it).
  useLiveRefresh(event => {
    loadRequests();
    if (event === null) {
      loadFriends(searchRef.current);
    }
  }, ['friendRequest', 'friendRequestAnswered', 'friendRequestAccepted', 'friendRequestRejected']);

  // Push can lag (the dispatch Job runs once a minute) or not arrive at all (notifications off).
  // So while this screen is open and I have a sent request waiting for an answer, re-check just
  // the small request list every OUTGOING_POLL_INTERVAL_MS - only in the foreground, never two at
  // once, and for at most OUTGOING_POLL_MAX_MS per visit. No sent request pending: no polling.
  const hasOutgoing = requests.some(request => request.direction === 'outgoing');
  useFocusedPolling(loadRequests, {
    enabled: hasOutgoing,
    intervalMs: OUTGOING_POLL_INTERVAL_MS,
    maxDurationMs: OUTGOING_POLL_MAX_MS,
  });

  // Searching (only within my own friends) as the text settles, never per keystroke.
  const isFirstSearchRef = useRef(true);
  useEffect(() => {
    if (isFirstSearchRef.current) {
      isFirstSearchRef.current = false;
      return undefined;
    }
    const timer = setTimeout(() => loadFriends(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [loadFriends, search]);

  const loadMore = () => {
    if (!nextCursor || isLoadingFriends || isLoadingMore) {
      return;
    }
    const loadId = loadIdRef.current;
    setIsLoadingMore(true);
    getFriends(authenticatedRequest, { query: search.trim() || undefined, cursor: nextCursor, limit: PAGE_LIMIT })
      .then(page => {
        if (loadId === loadIdRef.current) {
          setFriends(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.friendshipId === item.friendshipId))]);
          setNextCursor(page.nextCursor);
        }
      })
      .catch(() => setActionError(t('friends.loadFallback')))
      .finally(() => setIsLoadingMore(false));
  };

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadFriends(searchRef.current), loadRequests()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  /** One request's action: that row alone is busy (a second tap on it is ignored); every other row stays usable. */
  const runRequestAction = async (requestId: number, intent: 'answer' | 'cancel', action: () => Promise<void>) => {
    if (busyRequestIdsRef.current.has(requestId)) {
      return;
    }
    busyRequestIdsRef.current.add(requestId);
    setBusyRequestIds(new Set(busyRequestIdsRef.current));
    setActionError(null);
    try {
      await action();
    } catch (caughtError) {
      showMessage(getFriendRequestErrorMessage(caughtError, t, intent), { title: t('friends.requestDialogTitle') });
      // Whatever the server now knows (e.g. they cancelled it meanwhile) replaces the stale row at once.
      dropRequest(requestId);
      loadRequests();
    } finally {
      busyRequestIdsRef.current.delete(requestId);
      setBusyRequestIds(new Set(busyRequestIdsRef.current));
    }
  };

  const dropRequest = (requestId: number) => {
    setRequests(previous => previous.filter(request => request.requestId !== requestId));
    if (outgoingIdsRef.current.has(requestId)) {
      outgoingIdsRef.current = new Set([...outgoingIdsRef.current].filter(id => id !== requestId));
    }
  };

  const accept = (request: FriendRequest) =>
    runRequestAction(request.requestId, 'answer', async () => {
      const friend = await acceptFriendRequest(authenticatedRequest, request.requestId);
      dropRequest(request.requestId);
      // In 친구 at once (unless a search is narrowing the list - clearing it reloads anyway).
      if (!searchRef.current.trim()) {
        setFriends(previous => [friend, ...previous.filter(existing => existing.friendshipId !== friend.friendshipId)]);
      }
    });

  const decline = (request: FriendRequest) =>
    runRequestAction(request.requestId, 'answer', async () => {
      await declineFriendRequest(authenticatedRequest, request.requestId);
      dropRequest(request.requestId);
    });

  const cancel = (request: FriendRequest) =>
    runRequestAction(request.requestId, 'cancel', async () => {
      await cancelFriendRequest(authenticatedRequest, request.requestId);
      dropRequest(request.requestId);
    });

  const removeFromList = async (friend: Friend) => {
    setActionError(null);
    try {
      await removeFriend(authenticatedRequest, friend.friendshipId);
      setFriends(previous => previous.filter(existing => existing.friendshipId !== friend.friendshipId));
    } catch {
      setActionError(t('friends.actionFallback'));
    }
  };

  const incoming = requests.filter(request => request.direction === 'incoming');
  const outgoing = requests.filter(request => request.direction === 'outgoing');

  const refreshControl = <RefreshControl onRefresh={refresh} refreshing={isRefreshing} />;
  const banner = actionError ? <Text accessibilityLiveRegion="polite" style={styles.banner} testID="friends-action-error">{actionError}</Text> : null;

  const retryBlock = (onRetry: () => void, testID: string, failure: unknown) => (
    <LoadFailureState error={failure} message={t('friends.loadFallback')} onRetry={onRetry} retryLabel={t('history.retry')} testID={testID} />
  );

  const friendsList = (
    <FlatList
      key={viewMode}
      contentContainerStyle={styles.listContent}
      data={friends}
      numColumns={viewMode === 'grid' ? 2 : 1}
      keyboardShouldPersistTaps="handled"
      keyExtractor={friend => friend.friendshipId.toString()}
      ListEmptyComponent={
        !hasLoadedFriends ? (
          friendsError ? retryBlock(() => loadFriends(searchRef.current), 'friends-error', friendsFailure) : <ActivityIndicator style={styles.loading} testID="friends-loading" />
        ) : getFriendSearchEmptyState({ query: search, totalCount: friends.length, filteredCount: friends.length }) === 'noResults' ? (
          <Text style={styles.stateText}>{t('friends.searchEmpty')}</Text>
        ) : (
          <View style={styles.stateBlock} testID="friends-empty">
            <Text style={styles.stateTitle}>{t('friends.empty')}</Text>
            <Text style={styles.stateText}>{t('friends.emptyHint')}</Text>
            <Pressable accessibilityRole="button" onPress={() => setIsAddOpen(true)} style={styles.primaryButton} testID="friends-empty-add">
              <Text style={styles.primaryLabel}>{t('friends.add')}</Text>
            </Pressable>
          </View>
        )
      }
      ListFooterComponent={isLoadingMore ? <ActivityIndicator style={styles.loading} /> : undefined}
      ListHeaderComponent={
        <View>
          {/* [search] on the start side, the List/Grid switch pinned to the end edge. */}
          <View style={[styles.searchRow, viewMode === 'list' && styles.searchRowList]}>
            <View style={styles.searchField}>
              {/* A person glyph inside the field - decoration, not a control (a tap there reaches the input). */}
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.searchIcon} testID="friends-search-icon">
                <UserIcon color={colors.textSecondary} size={18} />
              </View>
              <TextInput
                accessibilityLabel={t('friends.search')}
                autoCorrect={false}
                onChangeText={setSearch}
                placeholder={t('friends.search')}
                style={styles.searchInput}
                testID="friends-search"
                value={search}
              />
            </View>
            <ViewModeToggle onChange={changeViewMode} value={viewMode} />
          </View>
          {banner}
          {hasLoadedFriends && friendsError ? retryBlock(() => loadFriends(searchRef.current), 'friends-stale', friendsFailure) : null}
        </View>
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      refreshControl={refreshControl}
      renderItem={({ item }) => (
        <FriendRow
          friend={item}
          layout={viewMode}
          onLongPress={() => setMenuFriend(item)}
          onPress={() => setSelected(item)}
          onSwipeDelete={() => setPendingRemoval(item)}
        />
      )}
      testID="friends-list"
    />
  );

  const requestList = (direction: 'incoming' | 'outgoing', data: readonly FriendRequest[]) => (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={data}
      keyExtractor={request => request.requestId.toString()}
      ListEmptyComponent={
        !hasLoadedRequests ? (
          requestsError ? retryBlock(loadRequests, `friends-${direction}-error`, requestsFailure) : <ActivityIndicator style={styles.loading} testID={`friends-${direction}-loading`} />
        ) : (
          <View style={styles.stateBlock} testID={`friends-${direction}-empty`}>
            <Text style={styles.stateTitle}>{t(direction === 'incoming' ? 'friends.incomingEmpty' : 'friends.outgoingEmpty')}</Text>
          </View>
        )
      }
      ListHeaderComponent={
        <View>
          {banner}
          {hasLoadedRequests && requestsError ? retryBlock(loadRequests, 'friends-requests-stale', requestsFailure) : null}
        </View>
      }
      refreshControl={refreshControl}
      renderItem={({ item }) => (
        <RequestRow
          isBusy={busyRequestIds.has(item.requestId)}
          onAccept={() => accept(item)}
          onCancel={() => cancel(item)}
          onDecline={() => decline(item)}
          onOpenPerson={() => openProfile({ jupleId: item.jupleId, displayName: item.displayName, profileImageUrl: item.profileImageUrl, profileImageVersion: item.profileImageVersion })}
          request={item}
        />
      )}
      testID={`friends-${direction}-list`}
    />
  );

  const tabs: readonly { readonly key: FriendsTab; readonly label: string; readonly count?: number; readonly emphasized?: boolean }[] = [
    { key: 'friends', label: t('friends.title') },
    { key: 'incoming', label: t('friends.tabIncoming'), count: incoming.length, emphasized: true },
    { key: 'outgoing', label: t('friends.tabOutgoing'), count: outgoing.length },
  ];

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <View accessibilityRole="tablist" style={styles.tabBar} testID="friends-tabs">
        {tabs.map(entry => {
          const isSelected = tab === entry.key;
          const count = entry.count ?? 0;
          return (
            <Pressable
              accessibilityLabel={count > 0 ? `${entry.label} ${count}` : entry.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              key={entry.key}
              onPress={() => setTab(entry.key)}
              style={[styles.tab, isSelected && styles.tabSelected]}
              testID={`friends-tab-${entry.key}`}
            >
              <Text numberOfLines={2} style={[styles.tabLabel, isSelected && styles.tabLabelSelected]}>{entry.label}</Text>
              {count > 0 ? (
                <View style={[styles.tabBadge, entry.emphasized ? styles.tabBadgeEmphasized : styles.tabBadgeMuted]}>
                  <Text
                    style={[styles.tabBadgeText, entry.emphasized ? styles.tabBadgeTextEmphasized : styles.tabBadgeTextMuted]}
                    testID={`friends-tab-${entry.key}-count`}
                  >
                    {formatBadgeCount(count)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab === 'friends' ? friendsList : tab === 'incoming' ? requestList('incoming', incoming) : requestList('outgoing', outgoing)}

      <FriendDetailModal
        friend={selected}
        onChanged={updated => {
          setFriends(previous => previous.map(friend => (friend.friendshipId === updated.friendshipId ? updated : friend)));
          setSelected(updated);
        }}
        onClose={() => setSelected(null)}
        onRemoved={friendshipId => {
          setFriends(previous => previous.filter(friend => friend.friendshipId !== friendshipId));
          setSelected(null);
        }}
      />
      <ActionMenuDialog
        actions={menuFriend ? [
          {
            label: t('profile.copyJupleId'),
            icon: CopyIcon,
            onPress: () => {
              const friend = menuFriend;
              afterMenuCloses(() => setMenuFriend(null), () => Clipboard.setString(atJupleId(friend.jupleId)));
            },
          },
          {
            label: t('friends.remove'),
            icon: TrashIcon,
            destructive: true,
            onPress: () => {
              const friend = menuFriend;
              afterMenuCloses(() => setMenuFriend(null), () => setPendingRemoval(friend));
            },
          },
        ] : []}
        cancelLabel={t('common.cancel')}
        onCancel={() => setMenuFriend(null)}
        onDismiss={onMenuDismiss}
        title={menuFriend ? friendPrimaryLabel(menuFriend) : undefined}
        visible={menuFriend !== null}
      />
      {messageDialog}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('friends.remove')}
        message={t('friends.removeConfirmMessage')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const friend = pendingRemoval;
          setPendingRemoval(null);
          if (friend) {
            removeFromList(friend).catch(() => undefined);
          }
        }}
        title={t('friends.removeConfirmTitle')}
        visible={pendingRemoval !== null}
      />
      {profileModal}
      <AddFriendModal
        friends={friends}
        onClose={() => setIsAddOpen(false)}
        onRequestSent={request => {
          setRequests(previous => [request, ...previous.filter(existing => existing.requestId !== request.requestId)]);
          outgoingIdsRef.current = new Set([...outgoingIdsRef.current, request.requestId]);
        }}
        onShowIncoming={() => {
          setIsAddOpen(false);
          setTab('incoming');
        }}
        onStale={() => {
          loadRequests();
          loadFriends(searchRef.current);
        }}
        requests={requests}
        visible={isAddOpen}
      />
    </StackScreenSafeArea>
  );
}

/** 친구 추가 - the header's [+], labelled for assistive technology. */
function FriendsAddHeaderButton({ onPress }: { readonly onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityLabel={t('friends.add')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={styles.headerButton}
      testID="friends-add-open"
    >
      <PlusIcon color={colors.textPrimary} size={22} />
    </Pressable>
  );
}

/**
 * A friend: photo, name, and my memo on one line beneath it. No Juple ID and no chevron (the ID is in
 * the detail and in the long-press menu; a friend without a nickname shows it as the name, since a
 * row needs one). The memo line is always reserved - even with no memo - so every row/tile of the
 * list has the same height. Tap opens the friend; long press opens the compact action popup; in List
 * a left swipe reveals 삭제. Grid is a centered 2-column tile with the same content.
 */
function FriendRow({ friend, layout, onPress, onLongPress, onSwipeDelete }: {
  readonly friend: Friend;
  readonly layout: ViewMode;
  readonly onPress: () => void;
  readonly onLongPress: () => void;
  readonly onSwipeDelete: () => void;
}) {
  const { fontScale } = useWindowDimensions();
  const hasNickname = !!friend.displayName?.trim();
  const isGrid = layout === 'grid';
  const avatar = <UserAvatar displayName={friend.displayName} imageUrl={friend.profileImageUrl} imageVersion={friend.profileImageVersion} jupleId={friend.jupleId} size={isGrid ? 56 : 44} />;
  const texts = (
    <>
      <Text numberOfLines={1} style={[styles.name, !hasNickname && ltrTextStyle, isGrid && styles.tileText]}>{friendPrimaryLabel(friend)}</Text>
      {/* Grid: name / @ID / memo, each on one reserved line (an empty one keeps its height, so every tile is the same size).
          The ID is never made up: no ID, an empty line. List shows the ID as its trailing column instead. */}
      {isGrid ? (
        <Text
          numberOfLines={1}
          style={[styles.tileId, ltrTextStyle, { minHeight: ID_LINE_HEIGHT * fontScale }]}
          testID={`friend-${friend.friendshipId}-id`}
        >
          {friend.jupleId ? atJupleId(friend.jupleId) : ''}
        </Text>
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.note, { minHeight: NOTE_LINE_HEIGHT * fontScale }, isGrid && styles.tileText]}
        testID={`friend-${friend.friendshipId}-note`}
      >
        {friend.myNote ?? ''}
      </Text>
    </>
  );
  if (isGrid) {
    return (
      <View style={styles.tileCell}>
        <Pressable
          accessibilityLabel={friendPrimaryLabel(friend)}
          accessibilityRole="button"
          onLongPress={onLongPress}
          onPress={onPress}
          style={({ pressed }) => [styles.tile, pressed && styles.rowPressed]}
          testID={`friend-${friend.friendshipId}`}
        >
          {avatar}
          <View style={styles.tileBody}>{texts}</View>
        </Pressable>
      </View>
    );
  }
  return (
    <SwipeableItemRow
      accessibilityLabel={friendPrimaryLabel(friend)}
      containerStyle={[savedLinkLayout.card, styles.friendCard]}
      onDelete={onSwipeDelete}
      onLongPress={onLongPress}
      onPress={onPress}
      testID={`friend-${friend.friendshipId}`}
    >
      <View style={styles.row}>
        {avatar}
        <View style={styles.rowText}>{texts}</View>
        {/* Trailing identity column, vertically centered (the memo keeps the whole line under the name) - always shown, even when the name falls back to the ID. */}
        {friend.jupleId ? (
          <Text numberOfLines={1} style={[styles.trailingId, ltrTextStyle]} testID={`friend-${friend.friendshipId}-id`}>{formatJupleId(friend.jupleId)}</Text>
        ) : null}
      </View>
    </SwipeableItemRow>
  );
}

/**
 * A request: who, then its actions on their own line below - so on a narrow screen the buttons
 * never squeeze the name. Received: [거절] [수락]; sent: 요청 대기 중 and [요청 취소].
 */
function RequestRow({ request, isBusy, onAccept, onDecline, onCancel, onOpenPerson }: {
  readonly request: FriendRequest;
  readonly onOpenPerson: () => void;
  readonly isBusy: boolean;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const hasNickname = !!request.displayName?.trim();
  const name = friendPrimaryLabel(request);
  const isIncoming = request.direction === 'incoming';
  return (
    <View style={styles.requestRow} testID={`friends-${request.direction}-${request.requestId}`}>
      <Pressable accessibilityLabel={`${name}, ${t('friends.personTitle')}`} accessibilityRole="button" onPress={onOpenPerson} style={styles.requestIdentity} testID={`friends-${request.direction}-person-${request.requestId}`}>
        <UserAvatar displayName={request.displayName} imageUrl={request.profileImageUrl} imageVersion={request.profileImageVersion} jupleId={request.jupleId} size={44} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={[styles.name, !hasNickname && ltrTextStyle]}>{name}</Text>
          {hasNickname ? <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{atJupleId(request.jupleId)}</Text> : null}
          {!isIncoming ? <Text numberOfLines={1} style={styles.pending}>{t('friends.requestPending')}</Text> : null}
        </View>
        {isBusy ? <ActivityIndicator size="small" testID={`friends-request-busy-${request.requestId}`} /> : null}
      </Pressable>
      <View style={styles.requestActions}>
        {isIncoming ? (
          <>
            <Pressable
              accessibilityLabel={t('friends.declineA11y', { name })}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={onDecline}
              style={[styles.secondaryButton, styles.actionButton, isBusy && styles.disabled]}
              testID={`friends-decline-${request.requestId}`}
            >
              <Text numberOfLines={2} style={styles.secondaryLabel}>{t('collaboration.decline')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('friends.acceptA11y', { name })}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={onAccept}
              style={[styles.primaryButton, styles.actionButton, isBusy && styles.disabled]}
              testID={`friends-accept-${request.requestId}`}
            >
              <Text numberOfLines={2} style={styles.primaryLabel}>{t('collaboration.accept')}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityLabel={t('friends.cancelA11y', { name })}
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            disabled={isBusy}
            onPress={onCancel}
            style={[styles.secondaryButton, styles.actionButton, isBusy && styles.disabled]}
            testID={`friends-cancel-${request.requestId}`}
          >
            <Text numberOfLines={2} style={styles.secondaryLabel}>{t('friends.cancelRequest')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  headerButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  // The same segmented look as the Share screen's tabs.
  tabBar: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 2,
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: 2,
  },
  tab: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  tabSelected: { backgroundColor: colors.surface, borderColor: colors.brand, borderWidth: 1 },
  tabLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  tabLabelSelected: { color: colors.brand, fontWeight: '700' },
  tabBadge: { alignItems: 'center', borderRadius: 10, flexShrink: 0, justifyContent: 'center', minWidth: 20, paddingHorizontal: 5 },
  tabBadgeEmphasized: { backgroundColor: colors.brand },
  tabBadgeMuted: { backgroundColor: colors.border },
  tabBadgeText: { fontSize: 12, fontWeight: '700', lineHeight: 20 },
  tabBadgeTextEmphasized: { color: colors.surface },
  tabBadgeTextMuted: { color: colors.textSecondary },
  listContent: { flexGrow: 1, paddingBottom: spacing.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  searchRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', marginBottom: spacing.xs },
  searchRowList: { marginBottom: spacing.md },
  searchField: { flex: 1, justifyContent: 'center', minWidth: 0 },
  searchIcon: { alignItems: 'center', bottom: 0, justifyContent: 'center', position: 'absolute', start: spacing.md, top: 0, zIndex: 1 },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingEnd: spacing.md,
    paddingStart: spacing.md + 18 + spacing.sm,
  },
  banner: { color: colors.danger, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.xs },
  // Rows are set apart by a hairline, not boxed cards.
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  // List cards sit closer together than the controls sit above the first one (the section gap is searchRowList).
  friendCard: { marginBottom: FRIEND_CARD_GAP },
  trailingId: { color: colors.textSecondary, flexShrink: 0, fontSize: 12, maxWidth: '38%' },
  rowPressed: { opacity: 0.6 },
  // Grid: 2 columns of centered tiles - the same card family as the List rows and Home's saved links (surface, hairline border, card radius).
  tileCell: { flexBasis: '50%', maxWidth: '50%', padding: spacing.xs },
  tile: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, gap: spacing.sm, minHeight: minTouchTarget + 60, paddingHorizontal: spacing.sm, paddingVertical: spacing.md },
  tileBody: { alignSelf: 'stretch', minWidth: 0 },
  tileText: { textAlign: 'center' },
  tileId: { color: colors.textSecondary, fontSize: 12, lineHeight: ID_LINE_HEIGHT, marginTop: 2, textAlign: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: NOTE_LINE_HEIGHT, marginTop: 2, opacity: 0.85 },
  pending: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 2 },
  requestRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  requestIdentity: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  requestActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  actionButton: { flexBasis: 0, flexGrow: 1, maxWidth: 200 },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.surface, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.xl },
  stateBlock: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl * 2 },
  stateTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
