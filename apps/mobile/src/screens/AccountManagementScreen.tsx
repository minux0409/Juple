import Clipboard from '@react-native-clipboard/clipboard';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getMyProfile, resolveSignInMethod, type SignInMethod, type UserProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { reauthenticateSameAccount } from '../auth/reauthentication';
import { formatJupleId } from '../collections/api/collaborationApi';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

const METHOD_LABEL_KEYS: Record<SignInMethod, string> = {
  email: 'account.methodEmail',
  google: 'account.methodGoogle',
  apple: 'account.methodApple',
  unknown: 'account.methodUnknown',
};

/**
 * 설정 > 계정 관리: the Juple ID, how this account signs in, password management where the sign-in
 * provider actually offers it, and - set apart at the bottom - account deletion.
 *
 * Juple keeps no password. An email account's password belongs to the sign-in service (Microsoft
 * Entra External ID), whose sign-in page offers a self-service reset - so the only honest action
 * here is "비밀번호 재설정" (open that page), never an in-app "change". A Google or Apple account has
 * no Juple password at all, and an unrecognized method gets no password action.
 */
export function AccountManagementScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const { userEmail } = useAuth();
  const { showNotificationToast } = useAppToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPasswordDialogVisible, setIsPasswordDialogVisible] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      setLoadError(null);
      getMyProfile(authenticatedRequest)
        .then(loaded => {
          if (isMounted) {
            setProfile(loaded);
          }
        })
        .catch(() => {
          if (isMounted) {
            setLoadError(t('profile.loadFallback'));
          }
        });
      return () => {
        isMounted = false;
      };
    }, [authenticatedRequest, t]),
  );

  const method = resolveSignInMethod(profile);

  const copyJupleId = () => {
    if (profile) {
      Clipboard.setString(profile.jupleId);
      showNotificationToast(t('account.jupleIdCopied'));
    }
  };

  const openPasswordReset = async () => {
    setIsPasswordDialogVisible(false);
    setNotice(null);
    setIsSigningIn(true);
    try {
      const outcome = await reauthenticateSameAccount();
      if (outcome === 'reauthenticated') {
        setNotice(t('account.passwordResetReturned'));
      } else {
        setNotice(t(outcome === 'differentAccount' ? 'settings.collectionLockDifferentAccount' : 'settings.collectionLockSignInCancelled'));
      }
    } catch {
      setNotice(t('settings.collectionLockSignInCancelled'));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {profile === null && !loadError ? <ActivityIndicator style={styles.loading} /> : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
        {profile ? (
          <View style={styles.card}>
            <View style={styles.row} testID="account-juple-id">
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{t('myPage.jupleId')}</Text>
                <Text selectable style={[styles.rowValue, styles.jupleId, ltrTextStyle]}>{`@${formatJupleId(profile.jupleId)}`}</Text>
              </View>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={copyJupleId} style={styles.rowAction} testID="account-juple-id-copy">
                <Text style={styles.rowActionLabel}>{t('account.copy')}</Text>
              </Pressable>
            </View>
            <View style={styles.divider} />
            <View style={styles.row} testID="account-sign-in-method">
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{t('account.signInMethod')}</Text>
                <Text style={styles.rowValue}>{t(METHOD_LABEL_KEYS[method])}</Text>
                {method === 'email' && userEmail ? (
                  <Text numberOfLines={1} style={[styles.rowDescription, ltrTextStyle]}>{userEmail}</Text>
                ) : null}
                {method === 'google' || method === 'apple' ? (
                  <Text style={styles.rowDescription} testID="account-password-managed-elsewhere">
                    {t(method === 'google' ? 'account.passwordManagedByGoogle' : 'account.passwordManagedByApple')}
                  </Text>
                ) : null}
              </View>
            </View>
            {method === 'email' ? (
              <>
                <View style={styles.divider} />
                <Pressable
                  accessibilityRole="button"
                  disabled={isSigningIn}
                  onPress={() => setIsPasswordDialogVisible(true)}
                  style={styles.row}
                  testID="account-password-reset"
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t('account.passwordReset')}</Text>
                    <Text style={styles.rowDescription}>{t('account.passwordResetDescription')}</Text>
                  </View>
                  {isSigningIn ? <ActivityIndicator /> : null}
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
        {notice ? <Text style={styles.notice} testID="account-notice">{notice}</Text> : null}

        <View style={styles.dangerCard} testID="account-delete-section">
          <Text style={styles.dangerTitle}>{t('account.deleteTitle')}</Text>
          <Text style={styles.dangerDescription}>{t('account.deleteSummary')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('DeleteAccount')}
            style={styles.dangerButton}
            testID="account-delete"
          >
            <Text style={styles.dangerButtonLabel}>{t('account.deleteAction')}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('account.passwordResetContinue')}
        destructive={false}
        message={t('account.passwordResetMessage')}
        onCancel={() => setIsPasswordDialogVisible(false)}
        onConfirm={openPasswordReset}
        title={t('account.passwordReset')}
        visible={isPasswordDialogVisible}
      />
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, width: '100%' },
  loading: { paddingVertical: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, paddingHorizontal: spacing.md, ...cardShadow },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minTouchTarget, paddingVertical: spacing.md },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  rowValue: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginTop: 2 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  rowDescription: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  jupleId: { letterSpacing: 1 },
  rowAction: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.xs },
  rowActionLabel: { color: colors.brand, fontSize: 14, fontWeight: '600' },
  divider: { backgroundColor: colors.divider, height: StyleSheet.hairlineWidth },
  notice: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.md },
  error: { color: colors.danger, fontSize: 14 },
  // Set apart and outlined in the danger color - only the button itself is emphasized, never the whole screen.
  dangerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  dangerTitle: { color: colors.danger, fontSize: 15, fontWeight: '700' },
  dangerDescription: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.xs },
  dangerButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.md,
    maxWidth: '100%',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
  },
  dangerButtonLabel: { color: colors.danger, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
