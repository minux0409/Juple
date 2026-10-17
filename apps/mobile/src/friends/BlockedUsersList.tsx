import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { formatJupleId } from '../collections/api/collaborationApi';
import { LoadFailureState } from '../components/LoadFailureState';
import { UserAvatar } from '../components/UserAvatar';
import { useMessageDialog } from '../components/useMessageDialog';
import { listBlockedUsers, unblockUser, type BlockedUser } from '../safety/safetyApi';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { atJupleId, friendPrimaryLabel } from './friendIdentity';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly users: readonly BlockedUser[] };

/**
 * 차단한 사용자, the last tab of 친구: who the signed-in person blocked - nickname, Juple ID and photo - each with 차단 해제. Unblocking
 * does not make anyone a friend again (the server does not restore a friendship). Only the caller's own list is ever shown - the server
 * returns nobody else's, so the people who blocked them never appear. Mounted only while its tab is open, so it shows the server's
 * current list each time.
 */
export function BlockedUsersList() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showMessage, messageDialog } = useMessageDialog();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', users: await listBlockedUsers(request) });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [request]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const unblock = async (user: BlockedUser) => {
    if (busyId) {
      return;
    }
    setBusyId(user.jupleId);
    try {
      await unblockUser(request, user.jupleId);
      setState(current =>
        current.kind === 'ready' ? { kind: 'ready', users: current.users.filter(entry => entry.jupleId !== user.jupleId) } : current,
      );
      showMessage(t('safety.unblockedDone'));
    } catch {
      showMessage(t('safety.blockFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.root} testID="blocked-users-panel">
      {state.kind === 'loading' ? <View style={styles.center}><ActivityIndicator /></View> : null}
      {state.kind === 'failed' ? <View style={styles.center}><LoadFailureState onRetry={() => { load().catch(() => undefined); }} testID="blocked-users-error" /></View> : null}
      {state.kind === 'ready' && state.users.length === 0 ? (
        <View style={styles.center}><Text style={styles.empty} testID="blocked-users-empty">{t('safety.blockedUsersEmpty')}</Text></View>
      ) : null}
      {state.kind === 'ready' && state.users.length > 0 ? (
        <FlatList
          contentContainerStyle={styles.list}
          data={state.users}
          keyExtractor={user => user.jupleId}
          renderItem={({ item }) => (
            <View style={styles.row} testID={`blocked-user-${item.jupleId}`}>
              <UserAvatar displayName={item.displayName} imageUrl={item.profileImageUrl} imageVersion={item.profileImageVersion} jupleId={item.jupleId} size={40} />
              <View style={styles.identity}>
                <Text numberOfLines={1} style={styles.name}>{friendPrimaryLabel({ jupleId: formatJupleId(item.jupleId), displayName: item.displayName })}</Text>
                {item.displayName?.trim() ? <Text numberOfLines={1} style={[styles.id, ltrTextStyle]}>{atJupleId(item.jupleId)}</Text> : null}
              </View>
              <Pressable
                accessibilityLabel={`${t('safety.unblock')}, ${friendPrimaryLabel({ jupleId: formatJupleId(item.jupleId), displayName: item.displayName })}`}
                accessibilityRole="button"
                accessibilityState={{ disabled: busyId !== null, busy: busyId === item.jupleId }}
                disabled={busyId !== null}
                onPress={() => { unblock(item).catch(() => undefined); }}
                style={[styles.unblock, busyId !== null && styles.disabled]}
                testID={`unblock-${item.jupleId}`}
              >
                {busyId === item.jupleId ? <ActivityIndicator size="small" /> : <Text numberOfLines={2} style={styles.unblockLabel}>{t('safety.unblock')}</Text>}
              </Pressable>
            </View>
          )}
        />
      ) : null}
      {messageDialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.lg },
  empty: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  list: { gap: spacing.sm, padding: spacing.lg },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget + 16, padding: spacing.md },
  identity: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  id: { color: colors.textSecondary, fontSize: 13 },
  unblock: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', maxWidth: '40%', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  unblockLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
