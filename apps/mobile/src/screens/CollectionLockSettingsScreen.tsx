import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, ScrollView, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { reauthenticateSameAccount } from '../auth/reauthentication';
import { isUserCancelledSignIn, signInFailureCode } from '../auth/signInErrors';
import {
  getCollectionLockPasswordStatus,
  type CollectionLockPasswordStatus,
} from '../collections/api/collectionLockPasswordApi';
import { clearCollectionUnlockGrants } from '../collections/collectionUnlockGrants';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { LoadFailureState } from '../components/LoadFailureState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { CollectionLockPasswordDialog, type CollectionLockPasswordDialogMode } from '../settings/CollectionLockPasswordDialog';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

/** Why the user is asked to sign in again: a first setup, or "forgot password". */
type SignInPurpose = 'setup' | 'forgot';

/**
 * Settings > 컬렉션 잠금: the one lock password that protects every Collection the user locks.
 * Set, change, or - when forgotten - replace it after signing in to the account again. There is no
 * way to see or recover an existing password: the server keeps only a one-way hash and the device
 * keeps nothing.
 *
 * Setting it without the current one (first setup and "forgot") always starts with a fresh
 * interactive sign-in of the same account; whether that sign-in is recent enough is decided by the
 * server from the new access token, never by the app. A sign-in the person cancels, closes or leaves
 * incomplete just returns here without a message; one that fails (network, server) says so. Only a
 * password the server actually saved is announced (a new one as 저장, a changed or reset one as 변경).
 */
export function CollectionLockSettingsScreen() {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [status, setStatus] = useState<CollectionLockPasswordStatus | null>(null);
  const [loadError, setLoadError] = useState<{ readonly cause: unknown } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signInPurpose, setSignInPurpose] = useState<SignInPurpose | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [dialogMode, setDialogMode] = useState<CollectionLockPasswordDialogMode | null>(null);
  // Whether the open password dialog replaces an existing password (change / forgot) or sets the
  // first one - decides which success message follows a save.
  const [isReplacingPassword, setIsReplacingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await getCollectionLockPasswordStatus(authenticatedRequest));
    } catch (caughtError) {
      setLoadError({ cause: caughtError });
    }
  }, [authenticatedRequest]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // iOS: the sign-in sheet is presented only once the confirmation dialog has finished going away (its Modal's onDismiss) - iOS
  // cannot present the system sign-in UI while another view controller is still being dismissed. Android starts at once.
  const pendingSignInRef = useRef<SignInPurpose | null>(null);
  const confirmSignIn = () => {
    const purpose = signInPurpose;
    if (purpose === null) {
      return;
    }
    setSignInPurpose(null);
    setNotice(null);
    setIsSigningIn(true);
    if (Platform.OS === 'ios') {
      pendingSignInRef.current = purpose;
    } else {
      signInAgain(purpose).catch(() => undefined);
    }
  };
  const onConfirmDialogDismissed = () => {
    const purpose = pendingSignInRef.current;
    pendingSignInRef.current = null;
    if (purpose !== null) {
      signInAgain(purpose).catch(() => undefined);
    }
  };

  const signInAgain = async (purpose: SignInPurpose) => {
    try {
      const outcome = await reauthenticateSameAccount();
      if (outcome === 'reauthenticated') {
        setIsReplacingPassword(purpose === 'forgot');
        setDialogMode('new');
      } else if (outcome === 'differentAccount') {
        // Not a cancellation: the current session was deliberately kept, and the person should know why.
        setNotice(t('settings.collectionLockDifferentAccount'));
      }
      // 'incomplete' (the page closed without tokens) stays quiet, like a cancel.
    } catch (caughtError) {
      // Closing or dismissing the sign-in page is a choice - quietly back to this screen. Anything else is a failed sign-in, and is
      // said - with the step's short code when there is one (see signInFailureCode), so a real-device failure can be pinned down.
      if (!isUserCancelledSignIn(caughtError)) {
        const code = signInFailureCode(caughtError);
        setNotice(code ? t('settings.collectionLockSignInFailed', { code }) : t('auth.failed'));
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const openChange = () => {
    setNotice(null);
    setIsReplacingPassword(true);
    setDialogMode('change');
  };

  /** Only after the server has saved the password - a finished sign-in alone is never announced. */
  const onSaved = () => {
    setDialogMode(null);
    // Every unlock grant was just revoked server-side - drop this device's copies too.
    clearCollectionUnlockGrants();
    setNotice(t(isReplacingPassword ? 'settings.collectionLockChanged' : 'settings.collectionLockSaved'));
    load();
  };

  const onSignInExpired = () => {
    setDialogMode(null);
    setNotice(t('settings.collectionLockSignInExpired'));
  };

  const isConfigured = status?.isConfigured === true;

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <KeyboardSafeView style={styles.keyboardArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.help}>{t('settings.collectionLockDescription')}</Text>
        {status === null && !loadError ? <ActivityIndicator style={styles.loading} /> : null}
        {loadError ? <LoadFailureState error={loadError.cause} onRetry={() => { load(); }} testID="lock-settings-load-error" /> : null}
        {status !== null ? (
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>{t('settings.collectionLockStatusLabel')}</Text>
              <Text style={styles.statusValue} testID="lock-settings-status">
                {isConfigured ? t('settings.collectionLockConfigured') : t('settings.collectionLockNotConfigured')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={isSigningIn || dialogMode !== null}
              onPress={() => (isConfigured ? openChange() : setSignInPurpose('setup'))}
              style={styles.primaryButton}
              testID={isConfigured ? 'lock-settings-change' : 'lock-settings-setup'}
            >
              {isSigningIn ? (
                <ActivityIndicator color={colors.onBrand} size="small" />
              ) : (
                <Text style={styles.primaryLabel}>
                  {isConfigured ? t('settings.collectionLockChangePassword') : t('settings.collectionLockSetPassword')}
                </Text>
              )}
            </Pressable>
            {isConfigured ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSigningIn || dialogMode !== null}
                onPress={() => setSignInPurpose('forgot')}
                style={styles.linkButton}
                testID="lock-settings-forgot"
              >
                <Text style={styles.linkLabel}>{t('settings.collectionLockForgot')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {notice ? <Text style={styles.notice} testID="lock-settings-notice">{notice}</Text> : null}
        {/* After the interactive re-authentication: drawn in the screen, never as a Modal (see the dialog's presentation). */}
        <CollectionLockPasswordDialog
          mode="new"
          onCancel={() => setDialogMode(null)}
          onSaved={onSaved}
          onSignInExpired={onSignInExpired}
          presentation="inline"
          visible={dialogMode === 'new'}
        />
      </ScrollView>
      </KeyboardSafeView>
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('settings.collectionLockContinue')}
        destructive={false}
        message={
          signInPurpose === 'forgot'
            ? t('settings.collectionLockSignInToReset')
            : t('settings.collectionLockSignInToConfirm')
        }
        onCancel={() => setSignInPurpose(null)}
        onConfirm={confirmSignIn}
        onDismiss={onConfirmDialogDismissed}
        title={signInPurpose === 'forgot' ? t('settings.collectionLockForgot') : t('settings.collectionLockSetPassword')}
        visible={signInPurpose !== null}
      />
      <CollectionLockPasswordDialog
        mode="change"
        onCancel={() => setDialogMode(null)}
        onSaved={onSaved}
        onSignInExpired={onSignInExpired}
        visible={dialogMode === 'change'}
      />
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  keyboardArea: { flex: 1 },
  content: { alignSelf: 'center', gap: spacing.md, maxWidth: 640, padding: spacing.lg, width: '100%' },
  loading: { paddingVertical: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: spacing.md, padding: spacing.lg },
  statusRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  statusLabel: { color: colors.textSecondary, fontSize: 14 },
  statusValue: { color: colors.textPrimary, flexShrink: 1, fontSize: 15, fontWeight: '700' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: { color: colors.onBrand, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  linkButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget },
  linkLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  help: { color: colors.textSecondary, fontSize: 13 },
  notice: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  error: { color: colors.dangerText, fontSize: 14 },
}));
