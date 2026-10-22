import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { ThemedTextInput } from '../components/ThemedTextInput';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { formatJupleId, personLabel } from '../collections/api/collaborationApi';
import { AppModal } from '../components/AppModal';
import { getFriendSearchEmptyState } from './friendSearchEmptyState';
import { LoadFailureState } from '../components/LoadFailureState';
import { SelectionIndicator } from '../components/SelectionIndicator';
import { UserAvatar } from '../components/UserAvatar';
import { ViewModeToggle } from '../components/ViewModeToggle';
import type { ViewMode } from '../settings/viewModePreference';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

const AVATAR_SIZE = 40;
const GRID_AVATAR_SIZE = 56;
const GRID_COLUMNS = 3;
import { getFriends, type Friend } from './api/friendsApi';

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;

export type FriendUnavailableReason = 'member' | 'pending' | 'added';

interface FriendPickerModalProps {
  readonly visible: boolean;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  /** Friends that cannot be picked, and why (already in the Collection, invited, or already in the list). */
  readonly unavailable: ReadonlyMap<string, FriendUnavailableReason>;
  readonly onClose: () => void;
  readonly onConfirm: (friends: readonly Friend[]) => void;
}

/**
 * 친구 선택: picks accepted friends to invite to a Collection (the invitations still go through the
 * normal invite/accept flow - being friends grants nothing). A large centered modal with search and
 * a paged, virtualized list, so it stays usable with many friends; any number can be selected. The
 * caller's own private note is shown here to help find people - it never leaves this picker (only
 * the Juple ID and display name are handed back).
 */
export function FriendPickerModal({ visible, authenticatedRequest, unavailable, onClose, onConfirm }: FriendPickerModalProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [friends, setFriends] = useState<readonly Friend[]>([]);
  // The query the shown friends were loaded for (null = nothing loaded yet): an empty list only means
  // "no results" / "no friends" for THAT query, never for text typed or cleared since.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ readonly cause: unknown } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [selected, setSelected] = useState<ReadonlyMap<string, Friend>>(new Map());
  // List | Grid is only a way of looking at the same friends (this opening of the picker; nothing is stored).
  const [layout, setLayout] = useState<ViewMode>('list');
  const isGrid = layout === 'grid';
  const loadIdRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setSearch('');
      setSelected(new Map());
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const loadId = ++loadIdRef.current;
    const timer = setTimeout(() => {
      setIsLoading(true);
      setError(null);
      getFriends(authenticatedRequest, { query: search.trim() || undefined, limit: PAGE_LIMIT })
        .then(page => {
          if (loadId === loadIdRef.current) {
            setFriends(page.items);
            setLoadedQuery(search.trim());
            setNextCursor(page.nextCursor);
          }
        })
        .catch(caughtError => {
          if (loadId === loadIdRef.current) {
            setError({ cause: caughtError });
          }
        })
        .finally(() => {
          if (loadId === loadIdRef.current) {
            setIsLoading(false);
          }
        });
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [authenticatedRequest, reloadToken, search, visible]);

  const loadMore = () => {
    if (!nextCursor || isLoading) {
      return;
    }
    const loadId = loadIdRef.current;
    getFriends(authenticatedRequest, { query: search.trim() || undefined, cursor: nextCursor, limit: PAGE_LIMIT })
      .then(page => {
        if (loadId === loadIdRef.current) {
          setFriends(previous => [...previous, ...page.items.filter(item => !previous.some(existing => existing.friendshipId === item.friendshipId))]);
          setNextCursor(page.nextCursor);
        }
      })
      .catch(() => undefined);
  };

  const toggle = (friend: Friend) =>
    setSelected(previous => {
      const next = new Map(previous);
      if (next.has(friend.jupleId)) {
        next.delete(friend.jupleId);
      } else {
        next.set(friend.jupleId, friend);
      }
      return next;
    });

  const reasonLabel = (reason: FriendUnavailableReason) =>
    reason === 'member' ? t('shareSheet.alreadyMember') : reason === 'pending' ? t('shareSheet.pendingLabel') : t('shareSheet.alreadyAdded');

  // The same rule as My Page > Friends. Without a query the list shown is every friend I have.
  const emptyState = getFriendSearchEmptyState({ query: loadedQuery ?? '', totalCount: friends.length, filteredCount: friends.length });

  return (
    <AppModal
      footer={
        <>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary} testID="friend-picker-cancel">
            <Text style={styles.secondaryLabel}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: selected.size === 0 }}
            disabled={selected.size === 0}
            onPress={() => onConfirm([...selected.values()])}
            style={[styles.primary, selected.size === 0 && styles.disabled]}
            testID="friend-picker-confirm"
          >
            <Text numberOfLines={2} style={styles.primaryLabel}>{t('shareSheet.addSelectedFriends', { count: selected.size })}</Text>
          </Pressable>
        </>
      }
      onClose={onClose}
      size="large"
      testID="friend-picker"
      title={t('shareSheet.chooseFriends')}
      visible={visible}
    >
      <View style={styles.searchRow}>
        <ThemedTextInput
          accessibilityLabel={t('friends.search')}
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder={t('friends.search')}
          style={[styles.search, styles.searchInput]}
          testID="friend-picker-search"
          value={search}
        />
        <ViewModeToggle onChange={setLayout} value={layout} />
      </View>
      <FlatList
        columnWrapperStyle={isGrid ? styles.gridRow : undefined}
        data={friends}
        key={layout}
        numColumns={isGrid ? GRID_COLUMNS : 1}
        initialNumToRender={20}
        keyboardShouldPersistTaps="handled"
        keyExtractor={friend => friend.friendshipId.toString()}
        ListEmptyComponent={isLoading || (loadedQuery !== search.trim() && !error) ? <ActivityIndicator style={styles.loading} /> : error ? (
          <LoadFailureState compact error={error.cause} onRetry={() => setReloadToken(previous => previous + 1)} testID="friend-picker-error" />
        ) : emptyState === 'none' ? undefined : (
          <Text style={styles.empty} testID="friend-picker-empty">{t(emptyState === 'noResults' ? 'friends.searchEmpty' : 'friends.empty')}</Text>
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => {
          const reason = unavailable.get(item.jupleId);
          const isSelected = selected.has(item.jupleId);
          const disabled = reason !== undefined;
          if (isGrid) {
            return (
              <Pressable
                accessibilityLabel={personLabel(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled }}
                disabled={disabled}
                onPress={() => toggle(item)}
                style={[styles.tile, isSelected && styles.tileSelected, disabled && styles.disabled]}
                testID={`friend-picker-${item.jupleId}`}
              >
                <UserAvatar
                  displayName={item.displayName}
                  imageUrl={item.profileImageUrl}
                  imageVersion={item.profileImageVersion}
                  jupleId={item.jupleId}
                  size={GRID_AVATAR_SIZE}
                />
                <SelectionIndicator selected={isSelected} style={styles.tileIndicator} testID={`friend-picker-indicator-${item.jupleId}`} />
                <Text numberOfLines={2} style={styles.tileName}>{personLabel(item)}</Text>
                {item.displayName ? <Text numberOfLines={1} style={[styles.tileMeta, ltrTextStyle]}>{formatJupleId(item.jupleId)}</Text> : null}
                {reason ? <Text numberOfLines={2} style={styles.tileReason}>{reasonLabel(reason)}</Text> : null}
              </Pressable>
            );
          }
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => toggle(item)}
              style={[styles.row, disabled && styles.disabled]}
              testID={`friend-picker-${item.jupleId}`}
            >
              <SelectionIndicator selected={isSelected} testID={`friend-picker-indicator-${item.jupleId}`} />
              {/* The friend's photo (from the friend list itself - no request per row), else the shared initial / person fallback. */}
              <UserAvatar
                displayName={item.displayName}
                imageUrl={item.profileImageUrl}
                imageVersion={item.profileImageVersion}
                jupleId={item.jupleId}
                size={AVATAR_SIZE}
              />
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.name}>{personLabel(item)}</Text>
                {item.myNote ? <Text numberOfLines={1} style={styles.note}>{item.myNote}</Text> : null}
                {item.displayName ? <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{formatJupleId(item.jupleId)}</Text> : null}
              </View>
              {reason ? <Text numberOfLines={2} style={styles.reason}>{reasonLabel(reason)}</Text> : null}
            </Pressable>
          );
        }}
        style={styles.list}
        testID="friend-picker-list"
      />
      {selected.size > 0 ? (
        <Text style={[styles.selectedCount, ltrTextStyle]} testID="friend-picker-selected-count">
          {t('shareSheet.selectedCount', { count: selected.size })}
        </Text>
      ) : null}
    </AppModal>
  );
}

const styles = themedStyles(() => ({
  search: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  searchRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  searchInput: { flex: 1 },
  list: { flex: 1, marginTop: spacing.sm },
  gridRow: { gap: spacing.sm, marginBottom: spacing.sm },
  tile: {
    alignItems: 'center',
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    flexBasis: 0,
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  tileSelected: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  tileIndicator: { position: 'absolute', right: spacing.xs, top: spacing.xs },
  tileName: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  tileMeta: { color: colors.textSecondary, fontSize: 11, textAlign: 'center' },
  tileReason: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  note: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  // A short status (참여 중 / 추가됨) - never allowed to push the name off a narrow row.
  reason: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, fontWeight: '600', maxWidth: '40%', textAlign: 'right' },
  selectedCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.lg },
  empty: { color: colors.textSecondary, fontSize: 14, paddingVertical: spacing.lg, textAlign: 'center' },
  secondary: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: minTouchTarget },
  secondaryLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.sm },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
}));
