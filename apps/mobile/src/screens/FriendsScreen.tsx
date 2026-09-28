import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { formatJupleId, lookupJupleId, personLabel, type JupleIdLookupResult } from '../collections/api/collaborationApi';
import { AppModal } from '../components/AppModal';
import { ensurePushPermissionOnce } from '../push/pushPermissionFlow';
import { useFocusedPolling, useLiveRefresh } from '../push/useLiveRefresh';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { TrashIcon } from '../icons/TrashIcon';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  FRIEND_NOTE_MAX_STORAGE_LENGTH,
  getFriendRequests,
  getFriends,
  removeFriend,
  sendFriendRequest,
  setFriendNote,
  type Friend,
  type FriendRequest,
} from '../friends/api/friendsApi';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;
/** While a sent friend request is waiting (Friends screen open, app in the foreground). */
export const OUTGOING_POLL_INTERVAL_MS = 10_000;
/** Per visit - after that, Push / focus / returning to the app refresh it. */
export const OUTGOING_POLL_MAX_MS = 10 * 60_000;

function getLookupErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('collaboration.lookupFallback');
}

function getRequestErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      switch (error.code) {
        case 'alreadyFriends':
          return t('friends.alreadyFriends');
        case 'requestPending':
          return t('friends.requestAlreadyPending');
        case 'incomingRequestExists':
          return t('friends.incomingRequestExists');
      }
    }
    if (error.kind === 'badRequest') {
      return t('friends.cannotAddSelf');
    }
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('friends.actionFallback');
}

/**
 * 친구: an address book of Juple users added by exact Juple ID and mutual consent. Being friends
 * grants nothing - it only makes people easy to find again (e.g. when inviting to a Category). The
 * note on each friend is the signed-in user's own and is shown only here and in the invite picker.
 */
export function FriendsScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();

  const [friends, setFriends] = useState<readonly Friend[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const loadIdRef = useRef(0);

  const [requests, setRequests] = useState<readonly FriendRequest[]>([]);

  const [jupleIdInput, setJupleIdInput] = useState('');
  const [lookupResult, setLookupResult] = useState<JupleIdLookupResult | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Friend | null>(null);

  const loadFriends = useCallback(
    async (query: string) => {
      const loadId = ++loadIdRef.current;
      setIsLoading(true);
      setError(null);
      try {
        const page = await getFriends(authenticatedRequest, { query: query.trim() || undefined, limit: PAGE_LIMIT });
        if (loadId === loadIdRef.current) {
          setFriends(page.items);
          setNextCursor(page.nextCursor);
        }
      } catch {
        if (loadId === loadIdRef.current) {
          setError(t('friends.loadFallback'));
        }
      } finally {
        if (loadId === loadIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    [authenticatedRequest, t],
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
      const outgoingIds = new Set(loaded.filter(request => request.direction === 'outgoing').map(request => request.requestId));
      const anAnswered = [...outgoingIdsRef.current].some(id => !outgoingIds.has(id));
      outgoingIdsRef.current = outgoingIds;
      if (anAnswered) {
        loadFriends(searchRef.current);
      }
    } catch {
      setError(t('friends.loadFallback'));
    }
  }, [authenticatedRequest, loadFriends, t]);

  useFocusEffect(
    useCallback(() => {
      loadFriends(searchRef.current);
      loadRequests();
      ensurePushPermissionOnce(authenticatedRequest);
    }, [authenticatedRequest, loadFriends, loadRequests]),
  );

  // A friend request arriving - or one I sent being accepted/declined - shows up at once while this
  // screen is open (and on returning to the app): an answered request leaves 보낸 친구 신청, and an
  // accepted one appears in the friend list (loadRequests notices the answered one and reloads it).
  useLiveRefresh(event => {
    loadRequests();
    if (event === null) {
      loadFriends(searchRef.current);
    }
  }, ['friendRequest', 'friendRequestAnswered']);

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
    if (!nextCursor || isLoading || isLoadingMore) {
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
      .catch(() => setError(t('friends.loadFallback')))
      .finally(() => setIsLoadingMore(false));
  };

  const lookup = async () => {
    const input = jupleIdInput.trim();
    if (!input || isLookingUp) {
      return;
    }
    setIsLookingUp(true);
    setAddMessage(null);
    setLookupResult(null);
    try {
      const result = await lookupJupleId(authenticatedRequest, input);
      if (result.isSelf) {
        setAddMessage(t('friends.cannotAddSelf'));
      } else {
        setLookupResult(result);
      }
    } catch (caughtError) {
      setAddMessage(getLookupErrorMessage(caughtError, t));
    } finally {
      setIsLookingUp(false);
    }
  };

  const sendRequest = async () => {
    if (!lookupResult || isSending) {
      return;
    }
    setIsSending(true);
    setAddMessage(null);
    try {
      await sendFriendRequest(authenticatedRequest, lookupResult.jupleId);
      setLookupResult(null);
      setJupleIdInput('');
      setAddMessage(t('friends.requestSent'));
      await loadRequests();
    } catch (caughtError) {
      setAddMessage(getRequestErrorMessage(caughtError, t));
      // An existing request from them is answered below, never duplicated.
      await loadRequests();
    } finally {
      setIsSending(false);
    }
  };

  const runAction = async (key: string, action: () => Promise<unknown>) => {
    if (busyKey !== null) {
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (caughtError) {
      setError(getRequestErrorMessage(caughtError, t));
    } finally {
      setBusyKey(null);
      await Promise.all([loadRequests(), loadFriends(search)]);
    }
  };

  const incoming = requests.filter(request => request.direction === 'incoming');
  const outgoing = requests.filter(request => request.direction === 'outgoing');

  const header = (
    <View>
      {/* 1. 받은 친구 신청 - first, and only while there is something to answer. */}
      {incoming.length > 0 ? (
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, styles.sectionTitleText]}>{t('friends.incomingRequests')}</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText} testID="friends-incoming-count">{incoming.length}</Text>
          </View>
        </View>
      ) : null}
      {incoming.map(request => (
        <View key={request.requestId} style={styles.card} testID={`friends-incoming-${request.requestId}`}>
          <View style={styles.cardText}>
            <Text numberOfLines={1} style={styles.name}>{personLabel(request)}</Text>
            {request.displayName ? <Text style={[styles.meta, ltrTextStyle]}>{formatJupleId(request.jupleId)}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busyKey !== null}
            onPress={() => runAction(`decline-${request.requestId}`, () => declineFriendRequest(authenticatedRequest, request.requestId))}
            style={[styles.secondaryButton, styles.cardButton]}
            testID={`friends-decline-${request.requestId}`}
          >
            <Text numberOfLines={2} style={styles.secondaryLabel}>{t('collaboration.decline')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busyKey !== null}
            onPress={() => runAction(`accept-${request.requestId}`, () => acceptFriendRequest(authenticatedRequest, request.requestId))}
            style={[styles.primaryButton, styles.cardButton]}
            testID={`friends-accept-${request.requestId}`}
          >
            <Text numberOfLines={2} style={styles.primaryLabel}>{t('collaboration.accept')}</Text>
          </Pressable>
        </View>
      ))}

      {/* Only the friend's ID goes here - the signed-in user's own ID lives on My Page. */}
      <Text style={styles.sectionTitle}>{t('friends.add')}</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={t('friends.friendJupleIdPlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          onChangeText={value => {
            setJupleIdInput(value);
            setLookupResult(null);
          }}
          onSubmitEditing={lookup}
          placeholder={t('friends.friendJupleIdPlaceholder')}
          style={[styles.input, ltrTextStyle]}
          testID="friends-add-input"
          value={jupleIdInput}
        />
        <Pressable
          accessibilityRole="button"
          disabled={isLookingUp || !jupleIdInput.trim()}
          onPress={lookup}
          style={[styles.secondaryButton, (isLookingUp || !jupleIdInput.trim()) && styles.disabled]}
          testID="friends-add-lookup"
        >
          {isLookingUp ? <ActivityIndicator size="small" /> : <Text style={styles.secondaryLabel}>{t('collaboration.find')}</Text>}
        </Pressable>
      </View>
      {lookupResult ? (
        <View style={styles.card} testID="friends-add-result">
          <View style={styles.cardText}>
            {lookupResult.displayName ? <Text numberOfLines={1} style={styles.name}>{lookupResult.displayName}</Text> : null}
            <Text style={[styles.meta, ltrTextStyle]}>{formatJupleId(lookupResult.jupleId)}</Text>
          </View>
          <Pressable accessibilityRole="button" disabled={isSending} onPress={sendRequest} style={[styles.primaryButton, styles.cardButton]} testID="friends-add-send">
            {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={2} style={styles.primaryLabel}>{t('friends.sendRequest')}</Text>}
          </Pressable>
        </View>
      ) : null}
      {addMessage ? <Text style={styles.notice} testID="friends-add-message">{addMessage}</Text> : null}

      <Text style={styles.sectionTitle}>{t('friends.title')}</Text>
      <TextInput
        accessibilityLabel={t('friends.search')}
        autoCorrect={false}
        onChangeText={setSearch}
        placeholder={t('friends.search')}
        style={[styles.input, styles.searchInput]}
        testID="friends-search"
        value={search}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );

  // 3. 보낸 친구 신청 - after the friend list.
  const footer = (
    <View>
      {isLoadingMore ? <ActivityIndicator style={styles.loading} /> : null}
      {outgoing.length > 0 ? <Text style={styles.sectionTitle} testID="friends-outgoing-title">{t('friends.outgoingRequests')}</Text> : null}
      {outgoing.map(request => (
        <View key={request.requestId} style={styles.card} testID={`friends-outgoing-${request.requestId}`}>
          <View style={styles.cardText}>
            <Text numberOfLines={1} style={styles.name}>{personLabel(request)}</Text>
            <Text numberOfLines={1} style={styles.meta}>{t('shareSheet.pendingLabel')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busyKey !== null}
            onPress={() => runAction(`cancel-${request.requestId}`, () => cancelFriendRequest(authenticatedRequest, request.requestId))}
            style={[styles.secondaryButton, styles.cardButton]}
            testID={`friends-cancel-${request.requestId}`}
          >
            <Text numberOfLines={2} style={styles.secondaryLabel}>{t('friends.cancelRequest')}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={friends}
        keyboardShouldPersistTaps="handled"
        keyExtractor={friend => friend.friendshipId.toString()}
        ListEmptyComponent={
          isLoading ? <ActivityIndicator style={styles.loading} /> : <Text style={styles.empty}>{search.trim() ? t('friends.searchEmpty') : t('friends.empty')}</Text>
        }
        ListFooterComponent={footer}
        ListHeaderComponent={header}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => setSelected(item)} style={styles.card} testID={`friend-${item.friendshipId}`}>
            <View style={styles.cardText}>
              <Text numberOfLines={1} style={styles.name}>{personLabel(item)}</Text>
              {item.displayName ? <Text style={[styles.meta, ltrTextStyle]}>{formatJupleId(item.jupleId)}</Text> : null}
              {item.myNote ? <Text numberOfLines={1} style={styles.note}>{item.myNote}</Text> : null}
            </View>
          </Pressable>
        )}
      />
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
    </StackScreenSafeArea>
  );
}

interface FriendDetailModalProps {
  readonly friend: Friend | null;
  readonly onClose: () => void;
  readonly onChanged: (friend: Friend) => void;
  readonly onRemoved: (friendshipId: number) => void;
}

/**
 * One friend, in Juple's standard centered modal (never a bottom sheet): nickname, Juple ID, the
 * signed-in user's own private note (editable - the modal moves up with the keyboard) and remove.
 * While saving or while the remove confirmation is open, it cannot be dismissed by accident.
 */
function FriendDetailModal({ friend, onClose, onChanged, onRemoved }: FriendDetailModalProps) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);

  useEffect(() => {
    setNote(friend?.myNote ?? '');
    setError(null);
  }, [friend]);

  if (!friend) {
    return null;
  }

  const save = async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      onChanged(await setFriendNote(authenticatedRequest, friend.friendshipId, note));
    } catch (caughtError) {
      setError(caughtError instanceof ApiError && caughtError.kind === 'badRequest' ? t('friends.noteInvalid') : t('friends.actionFallback'));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsRemoveConfirmVisible(false);
    try {
      await removeFriend(authenticatedRequest, friend.friendshipId);
      onRemoved(friend.friendshipId);
    } catch {
      setError(t('friends.actionFallback'));
    }
  };

  return (
    <>
      <AppModal
        dismissible={!isSaving && !isRemoveConfirmVisible}
        onClose={onClose}
        testID="friend-detail"
        title={personLabel(friend)}
        visible
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.meta, ltrTextStyle]}>{t('myPage.jupleId')} {formatJupleId(friend.jupleId)}</Text>
          <Text style={styles.sectionTitle}>{t('friends.note')}</Text>
          <TextInput
            accessibilityLabel={t('friends.note')}
            maxLength={FRIEND_NOTE_MAX_STORAGE_LENGTH}
            onChangeText={setNote}
            style={styles.noteInput}
            testID="friend-note-input"
            value={note}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={save} style={[styles.primaryButton, styles.fullWidth]} testID="friend-note-save">
            {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.primaryLabel}>{t('friends.saveNote')}</Text>}
          </Pressable>
          {/* A destructive action in the app's secondary-destructive look (red outline, like 계정 삭제);
              the confirmation that follows carries the filled red button. */}
          <Pressable accessibilityRole="button" onPress={() => setIsRemoveConfirmVisible(true)} style={styles.removeButton} testID="friend-remove">
            <TrashIcon color={colors.danger} size={16} />
            <Text numberOfLines={2} style={styles.removeLabel}>{t('friends.remove')}</Text>
          </Pressable>
        </ScrollView>
      </AppModal>
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('friends.remove')}
        message={t('friends.removeConfirmMessage')}
        onCancel={() => setIsRemoveConfirmVisible(false)}
        onConfirm={remove}
        title={t('friends.removeConfirmTitle')}
        visible={isRemoveConfirmVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { flexGrow: 1, padding: spacing.xl },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.lg },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  sectionTitleText: { flexShrink: 1 },
  countBadge: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 10,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
    minWidth: 20,
    paddingHorizontal: 6,
  },
  countBadgeText: { color: colors.surface, fontSize: 12, fontWeight: '700', lineHeight: 20 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 0, marginTop: spacing.xs },
  // Inside a modal's ScrollView: a plain full-width field (flex: 1 would collapse it in a column).
  noteInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    padding: spacing.md,
  },
  cardText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  note: { color: colors.textSecondary, fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  notice: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  primaryLabel: { color: colors.surface, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  secondaryButton: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: minTouchTarget, minWidth: 64, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  // A card's action buttons on a narrow screen (or with a long translation): they may shrink and
  // wrap their label to two lines, but never squeeze the person's name out of the row.
  cardButton: { flexShrink: 1, maxWidth: '45%', paddingHorizontal: spacing.sm },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.lg },
  empty: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.lg, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  fullWidth: { marginTop: spacing.md },
  removeButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  removeLabel: { color: colors.danger, flexShrink: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
