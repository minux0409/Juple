import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { formatJupleId, personLabel } from '../collections/api/collaborationApi';
import { AppModal } from '../components/AppModal';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
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
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlyMap<string, Friend>>(new Map());
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
            setNextCursor(page.nextCursor);
          }
        })
        .catch(() => {
          if (loadId === loadIdRef.current) {
            setError(t('friends.loadFallback'));
          }
        })
        .finally(() => {
          if (loadId === loadIdRef.current) {
            setIsLoading(false);
          }
        });
    }, search ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [authenticatedRequest, search, t, visible]);

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
      <TextInput
        accessibilityLabel={t('friends.search')}
        autoCorrect={false}
        onChangeText={setSearch}
        placeholder={t('friends.search')}
        style={styles.search}
        testID="friend-picker-search"
        value={search}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={friends}
        initialNumToRender={20}
        keyboardShouldPersistTaps="handled"
        keyExtractor={friend => friend.friendshipId.toString()}
        ListEmptyComponent={isLoading ? <ActivityIndicator style={styles.loading} /> : <Text style={styles.empty}>{t('friends.empty')}</Text>}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => {
          const reason = unavailable.get(item.jupleId);
          const isSelected = selected.has(item.jupleId);
          const disabled = reason !== undefined;
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected, disabled }}
              disabled={disabled}
              onPress={() => toggle(item)}
              style={[styles.row, disabled && styles.disabled]}
              testID={`friend-picker-${item.jupleId}`}
            >
              <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
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

const styles = StyleSheet.create({
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
  list: { flex: 1, marginTop: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  checkbox: { alignItems: 'center', borderColor: colors.border, borderRadius: 6, borderWidth: 2, height: 22, justifyContent: 'center', width: 22 },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkmark: { color: colors.surface, fontSize: 13, fontWeight: '800' },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  note: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  // A short status (참여 중 / 추가됨) - never allowed to push the name off a narrow row.
  reason: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, fontWeight: '600', maxWidth: '40%', textAlign: 'right' },
  selectedCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.lg },
  empty: { color: colors.textSecondary, fontSize: 14, paddingVertical: spacing.lg, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  secondary: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: minTouchTarget },
  secondaryLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.sm },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
