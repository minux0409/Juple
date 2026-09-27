import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteAccount } from '../api/accountApi';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { getMyProfile, setMyDisplayName } from '../api/profileApi';
import { formatJupleId } from '../collections/api/collaborationApi';
import { formatBadgeCount } from '../components/badgeCount';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DisplayNameDialog } from '../settings/DisplayNameDialog';
import { getFriendRequests } from '../friends/api/friendsApi';
import { GlobeIcon } from '../icons/GlobeIcon';
import { LockIcon } from '../icons/LockIcon';
import { LogoutIcon } from '../icons/LogoutIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { useLiveRefresh } from '../push/useLiveRefresh';
import {
  loadQuickSaveOnSharePreference,
  saveQuickSaveOnSharePreference,
} from '../settings/quickSaveOnSharePreference';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

function getDeleteAccountErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('myPage.deleteAccountErrorFallback');
}

/**
 * 내 페이지: Account (real login email when the id token has a decodable email-ish claim - see
 * idTokenClaims.ts - otherwise the pre-existing generic "signed in" sentence, never a placeholder)
 * → Settings (언어, 공유 즉시 저장) → Delete account (bottom danger action). Sign-out lives in the
 * header as a small icon with a confirm dialog, not a full-width button.
 */
export function MyPageScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut, userEmail } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeleteAccountDialogVisible, setIsDeleteAccountDialogVisible] = useState(false);
  const [isSignOutDialogVisible, setIsSignOutDialogVisible] = useState(false);
  // Synchronous re-entrancy guard against a double-tap triggering two concurrent deletions.
  const isDeletingAccountRef = useRef(false);

  const [isQuickSaveEnabled, setIsQuickSaveEnabled] = useState(true);
  const [isTogglingQuickSave, setIsTogglingQuickSave] = useState(false);

  // The public Juple ID others use to invite this user (never the internal id, never an email),
  // and the optional name collaborators see instead of it.
  const [jupleId, setJupleId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isDisplayNameDialogVisible, setIsDisplayNameDialogVisible] = useState(false);
  const [isSavingDisplayName, setIsSavingDisplayName] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [incomingFriendRequestCount, setIncomingFriendRequestCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      loadQuickSaveOnSharePreference().then(enabled => {
        if (isMounted) {
          setIsQuickSaveEnabled(enabled);
        }
      });
      getMyProfile(authenticatedRequest)
        .then(profile => {
          if (isMounted) {
            setJupleId(profile.jupleId);
            setDisplayName(profile.displayName);
          }
        })
        .catch(() => undefined);
      getFriendRequests(authenticatedRequest)
        .then(requests => {
          if (isMounted) {
            setIncomingFriendRequestCount(requests.filter(request => request.direction === 'incoming').length);
          }
        })
        .catch(() => undefined);
      return () => {
        isMounted = false;
      };
    }, [authenticatedRequest]),
  );

  // The 친구 badge follows a friend request Push while this screen is open, and returning to the app.
  const friendRequestLoadRef = useRef(0);
  useLiveRefresh(() => {
    const requestId = ++friendRequestLoadRef.current;
    getFriendRequests(authenticatedRequest)
      .then(requests => {
        if (requestId === friendRequestLoadRef.current) {
          setIncomingFriendRequestCount(requests.filter(request => request.direction === 'incoming').length);
        }
      })
      .catch(() => undefined);
  }, ['friendRequest']);

  // No clipboard module is bundled in this app (a native dependency) - the OS share sheet offers
  // "Copy" on both Android and iOS, and the ID text itself is selectable (long-press → copy).
  const shareJupleId = () => {
    if (jupleId) {
      Share.share({ message: jupleId }).catch(() => undefined);
    }
  };

  const saveDisplayName = async (value: string) => {
    if (isSavingDisplayName) {
      return;
    }
    setIsSavingDisplayName(true);
    setDisplayNameError(null);
    try {
      const profile = await setMyDisplayName(authenticatedRequest, value);
      setDisplayName(profile.displayName);
      setJupleId(profile.jupleId);
      setIsDisplayNameDialogVisible(false);
    } catch (caughtError) {
      setDisplayNameError(
        caughtError instanceof ApiError && caughtError.kind === 'badRequest'
          ? t('myPage.displayNameInvalid')
          : t('myPage.displayNameSaveFallback'),
      );
    } finally {
      setIsSavingDisplayName(false);
    }
  };

  const onToggleQuickSave = async (nextEnabled: boolean) => {
    if (isTogglingQuickSave) {
      return;
    }
    setIsTogglingQuickSave(true);
    setIsQuickSaveEnabled(nextEnabled);
    try {
      await saveQuickSaveOnSharePreference(nextEnabled);
    } catch {
      // Local-storage write failure - revert the optimistic flip, there is no server state to roll back.
      setIsQuickSaveEnabled(!nextEnabled);
    } finally {
      setIsTogglingQuickSave(false);
    }
  };

  const deleteAccountAction = async () => {
    if (isDeletingAccountRef.current) {
      return;
    }

    isDeletingAccountRef.current = true;
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteAccount(authenticatedRequest);
      // The account and all its data are already gone server-side at this point - signOut()'s
      // own push-unregister call becomes a harmless no-op. Reuses the existing sign-out flow so
      // there is no separate local-cleanup path to maintain for this screen.
      await signOut();
    } catch (caughtError) {
      isDeletingAccountRef.current = false;
      setIsDeletingAccount(false);
      setDeleteAccountError(getDeleteAccountErrorMessage(caughtError, t));
    }
  };

  const confirmDeleteAccount = () => {
    if (isDeletingAccountRef.current) {
      return;
    }

    setIsDeleteAccountDialogVisible(true);
  };

  const confirmSignOut = () => {
    setIsSignOutDialogVisible(true);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      {/*
        content is flexGrow:1 so it always fills at least the full viewport (already bounded by
        the tab bar above it - see DailyInboxScreen's remark, no tabBarHeight/insets.bottom belongs
        here either), with mainContent and the danger-zone footer as its only two direct children.
        marginTop:'auto' on the footer pushes it to the bottom of that space when the screen is
        short; if a long translation or small screen makes mainContent taller than the viewport,
        the auto margin simply collapses to 0 and the ScrollView scrolls normally instead - the
        footer is never clipped or pushed off-screen either way.
      */}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.mainContent}>
          <Text style={styles.title}>{t('myPage.title')}</Text>

          <Text style={styles.sectionTitle}>{t('myPage.account')}</Text>
          {/* An email address is a technical identifier and needs LTR isolation; the fallback
              sentence is natural-language copy and must keep following the active locale's own
              reading direction, so only force LTR when an actual email is shown. */}
          {/* One compact card: the account, then the nickname and Juple ID as single rows - no
              separate large card and no long explanation for either. */}
          <View style={styles.accountCard} testID="my-account-card">
            <Text numberOfLines={1} style={[styles.accountStatus, userEmail && ltrTextStyle]}>
              {userEmail ?? t('myPage.loggedInAs')}
            </Text>
            <View style={styles.accountDivider} />
            <View style={styles.accountRow} testID="my-display-name">
              <Text style={styles.accountRowLabel}>{t('myPage.nickname')}</Text>
              <Text numberOfLines={1} style={[styles.accountRowValue, !displayName && styles.displayNameUnset]}>
                {displayName ?? t('myPage.nicknameNotSet')}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={!jupleId}
                hitSlop={8}
                onPress={() => {
                  setDisplayNameError(null);
                  setIsDisplayNameDialogVisible(true);
                }}
                style={styles.accountRowAction}
                testID="my-display-name-edit"
              >
                <Text style={styles.accountRowActionLabel}>{t('myPage.displayNameChange')}</Text>
              </Pressable>
            </View>
            <View style={styles.accountDivider} />
            <View style={styles.accountRow} testID="my-juple-id">
              <Text style={styles.accountRowLabel}>{t('myPage.jupleId')}</Text>
              <Text numberOfLines={1} selectable style={[styles.accountRowValue, styles.jupleIdValue, ltrTextStyle]}>
                {jupleId ? formatJupleId(jupleId) : '—'}
              </Text>
              <Pressable
                accessibilityLabel={t('myPage.jupleIdCopy')}
                accessibilityRole="button"
                disabled={!jupleId}
                hitSlop={8}
                onPress={shareJupleId}
                style={styles.accountRowAction}
                testID="my-juple-id-copy"
              >
                <Text style={styles.accountRowActionLabel}>{t('myPage.jupleIdCopy')}</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t('myPage.settings')}</Text>
          <View style={styles.settingsGroup}>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('LanguageSettings')}
              style={styles.settingsRow}
            >
              <View style={styles.settingsRowIcon}>
                <GlobeIcon color={colors.textSecondary} size={18} />
              </View>
              <Text style={styles.settingsRowLabel}>{t('settings.language')}</Text>
            </Pressable>
            <View style={styles.settingsRowDivider} />
            <View style={styles.settingsRow}>
              <View style={styles.settingsRowIcon}>
                <ShareIcon color={colors.textSecondary} size={18} />
              </View>
              <View style={styles.settingsRowTextColumn}>
                <Text style={styles.settingsRowLabel}>{t('settings.quickSaveOnShare')}</Text>
                <Text style={styles.settingsRowDescription}>
                  {isQuickSaveEnabled
                    ? t('settings.quickSaveOnShareOnDescription')
                    : t('settings.quickSaveOnShareOffDescription')}
                </Text>
              </View>
              <Switch
                disabled={isTogglingQuickSave}
                onValueChange={onToggleQuickSave}
                value={isQuickSaveEnabled}
              />
            </View>
            <View style={styles.settingsRowDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Friends')}
              style={styles.settingsRow}
              testID="my-friends"
            >
              <View style={styles.settingsRowIcon}>
                <PeopleIcon color={colors.textSecondary} size={18} />
              </View>
              <Text style={styles.settingsRowLabel}>{t('friends.title')}</Text>
              {incomingFriendRequestCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText} testID="my-friends-badge">{formatBadgeCount(incomingFriendRequestCount)}</Text>
                </View>
              ) : null}
            </Pressable>
            <View style={styles.settingsRowDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('CollectionLockSettings')}
              style={styles.settingsRow}
              testID="my-collection-lock"
            >
              <View style={styles.settingsRowIcon}>
                <LockIcon color={colors.textSecondary} size={18} />
              </View>
              <Text style={styles.settingsRowLabel}>{t('settings.collectionLock')}</Text>
            </Pressable>
            <View style={styles.settingsRowDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Trash')}
              style={styles.settingsRow}
            >
              <View style={styles.settingsRowIcon}>
                <TrashIcon color={colors.textSecondary} size={18} />
              </View>
              <Text style={styles.settingsRowLabel}>{t('settings.trash')}</Text>
            </Pressable>
            <View style={styles.settingsRowDivider} />
            <Pressable
              accessibilityRole="button"
              onPress={confirmSignOut}
              style={styles.settingsRow}
            >
              <View style={styles.settingsRowIcon}>
                <LogoutIcon color={colors.textSecondary} size={18} />
              </View>
              <Text style={styles.settingsRowLabel}>{t('auth.logout')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.dangerZone}>
          {deleteAccountError ? <Text style={styles.error}>{deleteAccountError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isDeletingAccount }}
            disabled={isDeletingAccount}
            onPress={confirmDeleteAccount}
            style={[styles.deleteAccountButton, isDeletingAccount && styles.disabledButton]}
          >
            {isDeletingAccount ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <View style={styles.deleteAccountContent}>
                <TrashIcon color={colors.danger} size={16} />
                <Text style={styles.deleteAccountLabel}>{t('myPage.deleteAccount')}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>
      <DisplayNameDialog
        error={displayNameError}
        initialValue={displayName ?? ''}
        isSaving={isSavingDisplayName}
        onCancel={() => {
          if (!isSavingDisplayName) {
            setIsDisplayNameDialogVisible(false);
          }
        }}
        onSave={saveDisplayName}
        visible={isDisplayNameDialogVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('myPage.deleteAccountConfirmMessage')}
        onCancel={() => setIsDeleteAccountDialogVisible(false)}
        onConfirm={() => {
          setIsDeleteAccountDialogVisible(false);
          deleteAccountAction();
        }}
        title={t('myPage.deleteAccountConfirmTitle')}
        visible={isDeleteAccountDialogVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('auth.logout')}
        message={t('myPage.signOutConfirmMessage')}
        onCancel={() => setIsSignOutDialogVisible(false)}
        onConfirm={() => {
          setIsSignOutDialogVisible(false);
          signOut();
        }}
        title={t('myPage.signOutConfirmTitle')}
        visible={isSignOutDialogVisible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  // flexGrow (not flex) - this is a ScrollView's contentContainerStyle, which must be allowed to
  // grow past one viewport height when content is long, not clipped to it. See this screen's own
  // top-level comment on why mainContent + dangerZone (marginTop: 'auto' below) are its only two
  // direct children.
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  mainContent: {
    flexShrink: 0,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
  accountCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  accountDivider: {
    backgroundColor: colors.divider,
    height: StyleSheet.hairlineWidth,
  },
  // label | value (takes the remaining width, never pushes the action out) | action
  accountRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: minTouchTarget,
  },
  accountRowLabel: { color: colors.textSecondary, flexShrink: 0, fontSize: 13, fontWeight: '600', minWidth: 72 },
  accountRowValue: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '600', minWidth: 0 },
  displayNameUnset: { color: colors.textSecondary, fontWeight: '400' },
  jupleIdValue: { letterSpacing: 1 },
  accountRowAction: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.xs },
  accountRowActionLabel: { color: colors.brand, fontSize: 14, fontWeight: '600' },
  countBadge: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 10,
    justifyContent: 'center',
    marginStart: 'auto',
    minWidth: 20,
    paddingHorizontal: 6,
  },
  countBadgeText: { color: colors.surface, fontSize: 12, fontWeight: '700', lineHeight: 20 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  accountStatus: {
    color: colors.textPrimary,
    fontSize: 15,
    paddingVertical: spacing.sm + 2,
  },
  // One grouped white card (matches Home/Categories' floating-card language) holding every
  // settings row, rather than each row being its own separately bordered box.
  settingsGroup: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginTop: spacing.sm,
    ...cardShadow,
  },
  // No justifyContent:'space-between' here - the quick-save row's own settingsRowTextColumn
  // (flex:1) already consumes all remaining width to push its Switch flush to the end regardless,
  // and the language row (icon + bare label, no flexed spacer) needs its two children to simply
  // sit together at the start rather than being spread across the full row width.
  settingsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  // A fixed-width leading icon slot so every row's label starts at the same horizontal position
  // regardless of icon glyph width - neutral gray, matching this round's "너무 알록달록하지 않게,
  // 필요한 강조만 blue/red" rule (no per-row accent colors here).
  settingsRowIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginEnd: spacing.sm + 2,
    width: 22,
  },
  settingsRowDivider: {
    backgroundColor: colors.divider,
    height: 1,
    marginHorizontal: spacing.md,
  },
  settingsRowTextColumn: {
    flex: 1,
    marginEnd: spacing.md,
  },
  settingsRowLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  settingsRowDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
  dangerZone: {
    marginTop: 'auto',
    // Only matters once content is tall enough to make the auto margin above collapse to 0 (see
    // this screen's own top-level comment) - a minimum gap from the settings section either way.
    paddingTop: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  deleteAccountButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingVertical: spacing.sm + 4,
  },
  deleteAccountContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs + 2,
  },
  deleteAccountLabel: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
