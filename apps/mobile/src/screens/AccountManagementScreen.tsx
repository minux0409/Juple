import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getMyProfile, resolveSignInMethod, type SignInMethod, type UserProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { reauthenticateSameAccount } from '../auth/reauthentication';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { ChevronIcon } from '../icons/ChevronIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

const METHOD_LABEL_KEYS: Record<SignInMethod, string> = {
  email: 'account.methodEmail',
  google: 'account.methodGoogle',
  apple: 'account.methodApple',
  unknown: 'account.methodUnknown',
};

/**
 * 설정 > 계정 관리: how this account signs in, password management where the sign-in provider
 * actually offers it, and - set apart at the bottom - account deletion. (The Juple ID and its 복사
 * live on 프로필 편집.)
 *
 * Juple keeps no password. An email account's password belongs to the sign-in service (Microsoft
 * Entra External ID), whose sign-in page offers a self-service reset - so the only honest action
 * here is "비밀번호 재설정" (open that page), never an in-app "change". A Google or Apple account has
 * no Juple password at all, and an unrecognized method gets no password action.
 *
 * 비밀번호 재설정 opens the sign-in page at once. Stopping there (cancel, back, closing it) returns
 * here without any message. The sign-in result can't tell a finished reset from an ordinary sign-in
 * (both are just a fresh sign-in), so this screen never claims that the password was changed.
 */
export function AccountManagementScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const authenticatedRequest = useAuthenticatedApi();
  const { userEmail } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadError, setLoadError] = useState<{ readonly cause: unknown } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProfile = useCallback(() => {
      let isMounted = true;
      setLoadError(null);
      getMyProfile(authenticatedRequest)
        .then(loaded => {
          if (isMounted) {
            setProfile(loaded);
          }
        })
        .catch(caughtError => {
          if (isMounted) {
            setLoadError({ cause: caughtError });
          }
        });
      return () => {
        isMounted = false;
      };
    }, [authenticatedRequest]);

  useFocusEffect(loadProfile);
  // 다시 시도: the same load again (the focus load above covers the first one).
  useEffect(() => (reloadToken > 0 ? loadProfile() : undefined), [loadProfile, reloadToken]);

  const method = resolveSignInMethod(profile);

  const openPasswordReset = async () => {
    if (isSigningIn) {
      return;
    }
    setNotice(null);
    setIsSigningIn(true);
    try {
      // A finished sign-in (a reset or not) and an incomplete one both just return here, silently.
      const outcome = await reauthenticateSameAccount();
      if (outcome === 'differentAccount') {
        // Not a cancellation: the current session was deliberately kept, and the person should know why.
        setNotice(t('settings.collectionLockDifferentAccount'));
      }
    } catch {
      // Cancelled or abandoned sign-in - quietly back to this screen.
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        {profile === null && !loadError ? <ActivityIndicator style={styles.loading} /> : null}
        {loadError ? <LoadFailureState error={loadError.cause} onRetry={() => setReloadToken(previous => previous + 1)} testID="account-load-error" /> : null}
        {profile ? (
          <View style={styles.card}>
            <View style={styles.row} testID="account-sign-in-method">
              <View style={styles.rowText}>
                {/* Email: ONE row - the label at the start, the address at the end (it ellipsizes on a narrow
                    screen instead of wrapping to a second line). */}
                {method === 'email' && userEmail ? (
                  <View style={styles.valueRow}>
                    <Text style={styles.rowValue}>{t(METHOD_LABEL_KEYS[method])}</Text>
                    <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.emailValue, ltrTextStyle]} testID="account-email">{userEmail}</Text>
                  </View>
                ) : (
                  <Text style={styles.rowValue}>{t(METHOD_LABEL_KEYS[method])}</Text>
                )}
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
                  onPress={openPasswordReset}
                  style={styles.row}
                  testID="account-password-reset"
                >
                  <Text style={[styles.rowTitle, styles.rowText]}>{t('account.passwordReset')}</Text>
                  {isSigningIn ? <ActivityIndicator /> : <ChevronIcon color={colors.textSecondary} direction="right" size={18} />}
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
  rowValue: { color: colors.textPrimary, flexShrink: 0, fontSize: 16, fontWeight: '600' },
  valueRow: { alignItems: 'center', columnGap: spacing.md, flexDirection: 'row' },
  emailValue: { color: colors.textSecondary, flex: 1, fontSize: 15, minWidth: 0, textAlign: 'right' },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  rowDescription: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
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
