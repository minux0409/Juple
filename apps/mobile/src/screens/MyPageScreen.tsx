import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteAccount } from '../api/accountApi';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { GlobeIcon } from '../icons/GlobeIcon';
import { LogoutIcon } from '../icons/LogoutIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import type { RootStackParamList } from '../navigation/RootStack';
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
  const { signOut, userEmail, plan } = useAuth();
  const authenticatedRequest = useAuthenticatedApi();

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeleteAccountDialogVisible, setIsDeleteAccountDialogVisible] = useState(false);
  const [isSignOutDialogVisible, setIsSignOutDialogVisible] = useState(false);
  // Synchronous re-entrancy guard against a double-tap triggering two concurrent deletions.
  const isDeletingAccountRef = useRef(false);

  const [isQuickSaveEnabled, setIsQuickSaveEnabled] = useState(true);
  const [isTogglingQuickSave, setIsTogglingQuickSave] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      loadQuickSaveOnSharePreference().then(enabled => {
        if (isMounted) {
          setIsQuickSaveEnabled(enabled);
        }
      });
      return () => {
        isMounted = false;
      };
    }, []),
  );

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

  // No purchase flow exists yet (see this round's scope) - tapping the CTA is honest about that
  // rather than leading into a dead end or a fake checkout screen.
  const showPlusComingSoon = () => {
    Alert.alert(t('myPage.plusTitle'), t('myPage.plusComingSoonMessage'));
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
          <Text style={[styles.accountStatus, userEmail && ltrTextStyle]}>
            {userEmail ?? t('myPage.loggedInAs')}
          </Text>

          {/* Only ever shown once the real plan is confirmed Free - never while plan is still null
              (not yet bootstrapped) and never for Plus, so a Plus user never sees an upgrade CTA. */}
          {plan === 'Free' ? (
            <View style={styles.plusCard}>
              <View style={styles.plusHeaderRow}>
                <StarIcon color={colors.brand} filled size={20} />
                <Text style={styles.plusTitle}>{t('myPage.plusTitle')}</Text>
              </View>
              <Text style={styles.plusDescription}>{t('myPage.plusDescription')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={showPlusComingSoon}
                style={styles.plusCtaButton}
              >
                <Text style={styles.plusCtaLabel}>{t('myPage.plusCta')}</Text>
              </Pressable>
            </View>
          ) : null}

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
  },
  // Soft-blue "identity" card, not a plain white one - this is the one place on the screen meant
  // to visually stand out as an upsell, so it gets brandSoft instead of the surface/cardShadow
  // treatment every other grouped section on this screen uses.
  plusCard: {
    backgroundColor: colors.brandSoft,
    borderRadius: radii.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  plusHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs + 2,
  },
  plusTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  plusDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  plusCtaButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  plusCtaLabel: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: '700',
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
