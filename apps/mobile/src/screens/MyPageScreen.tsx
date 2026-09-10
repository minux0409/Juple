import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteAccount } from '../api/accountApi';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LogoutIcon } from '../icons/LogoutIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import {
  loadQuickSaveOnSharePreference,
  saveQuickSaveOnSharePreference,
} from '../settings/quickSaveOnSharePreference';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

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
    Alert.alert(t('myPage.signOutConfirmTitle'), t('myPage.signOutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.logout'),
        style: 'destructive',
        onPress: () => {
          signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('myPage.title')}</Text>
          <Pressable
            accessibilityLabel={t('auth.logout')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={confirmSignOut}
            style={styles.logoutButton}
          >
            <LogoutIcon color={colors.textPrimary} size={22} />
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>{t('myPage.account')}</Text>
        <Text style={styles.accountStatus}>{userEmail ?? t('myPage.loggedInAs')}</Text>

        <Text style={styles.sectionTitle}>{t('myPage.settings')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('LanguageSettings')}
          style={styles.settingsRow}
        >
          <Text style={styles.settingsRowLabel}>{t('settings.language')}</Text>
        </Pressable>
        <View style={styles.settingsRow}>
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
              <Text style={styles.deleteAccountLabel}>{t('myPage.deleteAccount')}</Text>
            )}
          </Pressable>
        </View>
      </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: spacing.xl,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  logoutButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  accountStatus: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  settingsRow: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
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
  deleteAccountLabel: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
