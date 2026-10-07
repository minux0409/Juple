import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { getMyProfile, type UserProfile } from '../api/profileApi';
import { formatJupleId } from '../collections/api/collaborationApi';
import { formatBadgeCount } from '../components/badgeCount';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScreenTitle } from '../components/ScreenTitle';
import { UserAvatar } from '../components/UserAvatar';
import { getFriendRequests } from '../friends/api/friendsApi';
import { LogoutIcon } from '../icons/LogoutIcon';
import { ShareIcon } from '../icons/ShareIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { screenIcons } from '../navigation/screenIcons';
import { useLiveRefresh } from '../push/useLiveRefresh';
import {
  loadQuickSaveOnSharePreference,
  saveQuickSaveOnSharePreference,
} from '../settings/quickSaveOnSharePreference';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * 내 페이지: a compact profile header (photo, nickname, @Juple ID, 프로필 편집) → one card of rows (언어,
 * 빠른 저장, 친구, 컬렉션 잠금, 삭제 이력, 계정 관리, 고객센터, 로그아웃) - deliberately without a
 * "설정" heading, since they are not all settings. Account deletion is deliberately NOT
 * on this page - it lives under 계정 관리, behind its own multi-step flow. Sign-out asks first.
 */
export function MyPageScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();

  const [isSignOutDialogVisible, setIsSignOutDialogVisible] = useState(false);
  const [isQuickSaveEnabled, setIsQuickSaveEnabled] = useState(true);
  const [isTogglingQuickSave, setIsTogglingQuickSave] = useState(false);

  // The public Juple ID (never the internal id, never an email), the optional nickname people see
  // and the profile photo - refreshed whenever the page regains focus (e.g. back from 프로필 편집).
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
        .then(loaded => {
          if (isMounted) {
            setProfile(loaded);
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
  }, ['friendRequest', 'friendRequestAnswered']);

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

  const jupleId = profile?.jupleId ?? null;

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenTitle icon={screenIcons.myPage} textStyle={styles.title} title={t('myPage.title')} />

        {/* Compact profile header - never a large SNS-style cover. The nickname line falls back to
            "설정 안 됨" (the Juple ID below is what others then see). */}
        <View style={styles.profileCard} testID="my-profile-header">
          {jupleId ? (
            <UserAvatar
              displayName={profile?.displayName}
              imageUrl={profile?.profileImageUrl}
              imageVersion={profile?.profileImageVersion}
              jupleId={jupleId}
              size={60}
            />
          ) : (
            <View style={styles.avatarPlaceholder} />
          )}
          <View style={styles.profileText}>
            <Text
              numberOfLines={1}
              style={[styles.profileName, !profile?.displayName && styles.profileNameUnset]}
              testID="my-display-name"
            >
              {profile?.displayName ?? t('myPage.nicknameNotSet')}
            </Text>
            <Text numberOfLines={1} selectable style={[styles.profileJupleId, ltrTextStyle]} testID="my-juple-id">
              {jupleId ? `@${formatJupleId(jupleId)}` : '—'}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={t('profile.edit')}
            accessibilityRole="button"
            disabled={!jupleId}
            onPress={() => navigation.navigate('ProfileEdit')}
            style={styles.editButton}
            testID="my-profile-edit"
          >
            <screenIcons.profileEdit color={colors.textPrimary} size={20} />
          </Pressable>
        </View>

        <View style={styles.settingsGroup}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('LanguageSettings')}
            style={styles.settingsRow}
          >
            <View style={styles.settingsRowIcon}>
              <screenIcons.language color={colors.textSecondary} size={18} />
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
              <screenIcons.friends color={colors.textSecondary} size={18} />
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
              <screenIcons.collectionLock color={colors.textSecondary} size={18} />
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
              <screenIcons.trash color={colors.textSecondary} size={18} />
            </View>
            <Text style={styles.settingsRowLabel}>{t('settings.trash')}</Text>
          </Pressable>
          <View style={styles.settingsRowDivider} />
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('AccountManagement')}
            style={styles.settingsRow}
            testID="my-account-management"
          >
            <View style={styles.settingsRowIcon}>
              <screenIcons.account color={colors.textSecondary} size={18} />
            </View>
            <Text style={styles.settingsRowLabel}>{t('account.title')}</Text>
          </Pressable>
          <View style={styles.settingsRowDivider} />
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('CustomerCenter')}
            style={styles.settingsRow}
            testID="my-customer-center"
          >
            <View style={styles.settingsRowIcon}>
              <screenIcons.customerCenter color={colors.textSecondary} size={18} />
            </View>
            <Text style={styles.settingsRowLabel}>{t('customerCenter.title')}</Text>
          </Pressable>
          <View style={styles.settingsRowDivider} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsSignOutDialogVisible(true)}
            style={styles.settingsRow}
          >
            <View style={styles.settingsRowIcon}>
              <LogoutIcon color={colors.textSecondary} size={18} />
            </View>
            <Text style={styles.settingsRowLabel}>{t('auth.logout')}</Text>
          </Pressable>
        </View>
      </ScrollView>
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

const AVATAR_SIZE = 60;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
  },
  // avatar | name + @ID (takes the remaining width, never pushes the button out) | 프로필 편집
  profileCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    ...cardShadow,
  },
  avatarPlaceholder: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  profileNameUnset: { color: colors.textSecondary, fontWeight: '500' },
  profileJupleId: { color: colors.textSecondary, fontSize: 14, letterSpacing: 0.5, marginTop: 2 },
  editButton: {
    alignItems: 'center',
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
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
  // One grouped white card (matches Home/Categories' floating-card language) holding every
  // settings row, rather than each row being its own separately bordered box.
  settingsGroup: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginTop: spacing.lg,
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
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  settingsRowDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 3,
  },
});
