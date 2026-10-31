import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportantState } from '../components/ImportantState';
import { Pressable } from '../components/Pressable';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import { useMessageDialog } from '../components/useMessageDialog';
import { formatJupleId } from '../collections/api/collaborationApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { listBlockedUsers, unblockUser, type BlockedUser } from '../safety/safetyApi';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

const nameOf = (person: BlockedUser) => person.displayName ?? formatJupleId(person.jupleId);

/**
 * 차단한 사용자 (내 페이지 > 친구 관리): the people I blocked, when, and 차단 해제 behind a confirmation. Stored on the server, so it is the same on
 * every device. A Collection of theirs that I am still a member of is out of my lists: it is listed here, so opening or leaving it stays possible.
 */
export function BlockedUsersScreen() {
  const { t, i18n } = useTranslation();
  const request = useAuthenticatedApi();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showMessage, messageDialog } = useMessageDialog();
  const [people, setPeople] = useState<readonly BlockedUser[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<BlockedUser | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setPeople(await listBlockedUsers(request));
    } catch {
      setFailed(true);
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  const unblock = async () => {
    if (pending === null || isBusy) {
      return;
    }
    setIsBusy(true);
    try {
      await unblockUser(request, pending.jupleId);
      setPeople(current => current?.filter(person => person.jupleId !== pending.jupleId) ?? null);
      setPending(null);
      showMessage(t('safety.unblockedDone'));
    } catch {
      setPending(null);
      showMessage(t('importantState.loadFailedTitle'));
    } finally {
      setIsBusy(false);
    }
  };

  const blockedOn = (person: BlockedUser) => {
    const date = new Date(person.blockedAtUtc);
    return Number.isNaN(date.getTime()) ? null : t('safety.blockedAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date) });
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      {people === null ? (
        failed ? <ImportantState onRetry={load} testID="blocked-users-error" /> : <ActivityIndicator style={styles.loading} testID="blocked-users-loading" />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={people}
          keyExtractor={person => person.jupleId}
          ListEmptyComponent={<Text style={styles.empty} testID="blocked-users-empty">{t('safety.blockedUsersEmpty')}</Text>}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`blocked-user-${item.jupleId}`}>
              <View style={styles.row}>
                <UserAvatar displayName={item.displayName} imageUrl={item.profileImageUrl} imageVersion={item.profileImageVersion} jupleId={item.jupleId} size={40} />
                <View style={styles.text}>
                  <Text numberOfLines={1} style={styles.name}>{nameOf(item)}</Text>
                  <Text numberOfLines={1} style={[styles.detail, ltrTextStyle]}>{formatJupleId(item.jupleId)}</Text>
                  {blockedOn(item) ? <Text style={styles.detail}>{blockedOn(item)}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => setPending(item)} style={styles.unblock} testID={`blocked-user-unblock-${item.jupleId}`}>
                  <Text style={styles.unblockLabel}>{t('safety.unblock')}</Text>
                </Pressable>
              </View>
              {item.hiddenCollections.length > 0 ? (
                <View style={styles.hidden}>
                  <Text style={styles.detail}>{t('safety.hiddenCollectionsTitle')}</Text>
                  {item.hiddenCollections.map(collection => (
                    <Pressable
                      accessibilityRole="link"
                      key={collection.id}
                      onPress={() => navigation.navigate('CollectionDetails', { collectionId: collection.id })}
                      style={styles.hiddenRow}
                      testID={`blocked-user-collection-${collection.id}`}
                    >
                      <Text numberOfLines={1} style={styles.hiddenName}>{collection.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )}
          testID="blocked-users-list"
        />
      )}
      <ConfirmDialog
        busy={isBusy}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('safety.unblock')}
        destructive={false}
        message={t('safety.unblockMessage')}
        onCancel={() => { if (!isBusy) { setPending(null); } }}
        onConfirm={() => { unblock().catch(() => undefined); }}
        title={t('safety.unblockTitle', { name: pending ? nameOf(pending) : '' })}
        visible={pending !== null}
      />
      {messageDialog}
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  loading: { marginTop: spacing.xl },
  list: { flexGrow: 1, gap: spacing.sm, padding: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, padding: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  unblock: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexShrink: 0, justifyContent: 'center', maxWidth: '40%', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  unblockLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  hidden: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: spacing.md, paddingTop: spacing.sm },
  hiddenRow: { justifyContent: 'center', minHeight: minTouchTarget },
  hiddenName: { color: colors.brandText, fontSize: 14, fontWeight: '600' },
}));
