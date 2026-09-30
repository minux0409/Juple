import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteAccount } from '../api/accountApi';
import { ApiError } from '../api/ApiError';
import { getMyProfile } from '../api/profileApi';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { reauthenticateSameAccount } from '../auth/reauthentication';
import { formatJupleId } from '../collections/api/collaborationApi';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { RECENT_AUTHENTICATION_REQUIRED_CODE } from '../settings/CollectionLockPasswordDialog';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

type Step = 'warning' | 'reauthenticate' | 'confirm';

/**
 * What account deletion removes - exactly what the server's AccountDeletionStore deletes, nothing
 * more (see backend IAccountDeletionStore): no item is listed here that is not actually removed.
 */
const DELETED_DATA_KEYS = [
  'deleteAccount.dataLinks',
  'deleteAccount.dataPhotos',
  'deleteAccount.dataCollections',
  'deleteAccount.dataSharing',
  'deleteAccount.dataFriends',
  'deleteAccount.dataNotifications',
] as const;

/** Case, spaces, the display separator and a leading @ never matter - "@k7mp-4q8n" matches K7MP4Q8N. */
export function normalizeTypedJupleId(value: string): string {
  return value.replace(/[\s@-]/g, '').toUpperCase();
}

/**
 * 설정 > 계정 관리 > 계정 삭제, in three deliberate steps so it can never happen from a stray tap:
 * 1. what will be deleted, forever (continue is a separate, danger-styled action);
 * 2. signing in again - the server itself refuses deletion unless the current access token's
 *    auth_time is recent, so the app never decides this;
 * 3. typing the account's own Juple ID (locale-independent, and it names exactly which account)
 *    before the final button is even enabled.
 * Deleted server-side (not recoverable), then signed out through the regular sign-out flow.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const authenticatedRequest = useAuthenticatedApi();
  const { signOut } = useAuth();

  const [step, setStep] = useState<Step>('warning');
  const [jupleId, setJupleId] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  // Synchronous re-entrancy guard against a double tap starting two deletions.
  const isDeletingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    getMyProfile(authenticatedRequest)
      .then(profile => {
        if (isMounted) {
          setJupleId(profile.jupleId);
        }
      })
      .catch(() => {
        if (isMounted) {
          setNotice(t('profile.loadFallback'));
        }
      });
    return () => {
      isMounted = false;
    };
  }, [authenticatedRequest, t]);

  const signInAgain = async () => {
    setNotice(null);
    setIsBusy(true);
    try {
      const outcome = await reauthenticateSameAccount();
      if (outcome === 'reauthenticated') {
        setTyped('');
        setStep('confirm');
      } else {
        setNotice(t(outcome === 'differentAccount' ? 'settings.collectionLockDifferentAccount' : 'settings.collectionLockSignInCancelled'));
      }
    } catch {
      setNotice(t('settings.collectionLockSignInCancelled'));
    } finally {
      setIsBusy(false);
    }
  };

  const isConfirmed = jupleId !== null && normalizeTypedJupleId(typed) === jupleId;

  const deleteNow = async () => {
    if (!isConfirmed || isDeletingRef.current) {
      return;
    }
    isDeletingRef.current = true;
    setIsBusy(true);
    setNotice(null);
    try {
      await deleteAccount(authenticatedRequest);
      // Already gone server-side - the regular sign-out's own cleanup (push unregister etc.)
      // becomes a harmless no-op, so there is no separate local-cleanup path to maintain.
      await signOut();
    } catch (caughtError) {
      isDeletingRef.current = false;
      setIsBusy(false);
      if (caughtError instanceof ApiError && caughtError.code === RECENT_AUTHENTICATION_REQUIRED_CODE) {
        // Took longer than the server's recent-sign-in window: sign in again, nothing was deleted.
        setStep('reauthenticate');
        setNotice(t('settings.collectionLockSignInExpired'));
      } else if (caughtError instanceof ApiError && caughtError.kind === 'unauthorized') {
        setNotice(t('errors.unauthorized'));
      } else {
        setNotice(t('myPage.deleteAccountErrorFallback'));
      }
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'warning' ? (
          <View testID="delete-account-warning">
            <Text style={styles.title}>{t('deleteAccount.warningTitle')}</Text>
            <Text style={styles.body}>{t('deleteAccount.warningIntro')}</Text>
            <View style={styles.list}>
              {DELETED_DATA_KEYS.map(key => (
                <View key={key} style={styles.listRow}>
                  <Text style={styles.bullet}>{'•'}</Text>
                  <Text style={styles.listText}>{t(key)}</Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setNotice(null);
                setStep('reauthenticate');
              }}
              style={styles.dangerOutlineButton}
              testID="delete-account-continue"
            >
              <Text style={styles.dangerOutlineLabel}>{t('deleteAccount.continue')}</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'reauthenticate' ? (
          <View testID="delete-account-reauthenticate">
            <Text style={styles.title}>{t('deleteAccount.reauthTitle')}</Text>
            <Text style={styles.body}>{t('deleteAccount.reauthMessage')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: isBusy, disabled: isBusy }}
              disabled={isBusy}
              onPress={signInAgain}
              style={styles.primaryButton}
              testID="delete-account-sign-in"
            >
              {isBusy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryLabel}>{t('deleteAccount.reauthAction')}</Text>}
            </Pressable>
          </View>
        ) : null}

        {step === 'confirm' ? (
          <View testID="delete-account-confirm">
            <Text style={styles.title}>{t('deleteAccount.confirmTitle')}</Text>
            <Text style={styles.body}>{t('deleteAccount.confirmMessage')}</Text>
            <Text selectable style={[styles.jupleId, ltrTextStyle]} testID="delete-account-expected-id">
              {jupleId ? formatJupleId(jupleId) : '—'}
            </Text>
            <TextInput
              accessibilityLabel={t('deleteAccount.confirmPlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!isBusy}
              maxLength={32}
              onChangeText={setTyped}
              placeholder={t('deleteAccount.confirmPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              spellCheck={false}
              style={[styles.input, ltrTextStyle]}
              testID="delete-account-confirm-input"
              value={typed}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: isBusy, disabled: !isConfirmed || isBusy }}
              disabled={!isConfirmed || isBusy}
              onPress={deleteNow}
              style={[styles.dangerButton, (!isConfirmed || isBusy) && styles.disabled]}
              testID="delete-account-final"
            >
              {isBusy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.dangerLabel}>{t('deleteAccount.deleteNow')}</Text>}
            </Pressable>
          </View>
        ) : null}

        {notice ? <Text style={styles.notice} testID="delete-account-notice">{notice}</Text> : null}

        <Pressable
          accessibilityRole="button"
          disabled={isBusy && step === 'confirm'}
          onPress={() => navigation.goBack()}
          style={styles.cancelButton}
          testID="delete-account-cancel"
        >
          <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
        </Pressable>
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 560, padding: spacing.xl, width: '100%' },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22, marginTop: spacing.sm },
  list: { marginTop: spacing.md },
  listRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  bullet: { color: colors.textSecondary, fontSize: 15, lineHeight: 22 },
  listText: { color: colors.textPrimary, flex: 1, fontSize: 15, lineHeight: 22 },
  jupleId: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', letterSpacing: 2, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.xl,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: minTouchTarget + 4,
    paddingHorizontal: spacing.lg,
  },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  dangerOutlineButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.xl,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.xl,
    minHeight: minTouchTarget + 4,
    paddingHorizontal: spacing.lg,
  },
  dangerOutlineLabel: { color: colors.danger, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.xl,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: minTouchTarget + 4,
    paddingHorizontal: spacing.lg,
  },
  dangerLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  notice: { color: colors.danger, fontSize: 14, marginTop: spacing.md },
  cancelButton: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget },
  cancelLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
