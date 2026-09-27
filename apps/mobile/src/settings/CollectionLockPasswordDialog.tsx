import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { changeCollectionLockPassword, resetCollectionLockPassword } from '../collections/api/collectionLockPasswordApi';
import { LOCK_PASSWORD_MAX_LENGTH, LOCK_PASSWORD_MIN_LENGTH } from '../collections/CollectionLockDialog';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

export const RECENT_AUTHENTICATION_REQUIRED_CODE = 'recentAuthenticationRequired';

/**
 * "change": current + new + confirm. "new": new + confirm only - first setup and "forgot password",
 * reached only right after a same-account sign-in (the server re-checks how recent it was).
 */
export type CollectionLockPasswordDialogMode = 'change' | 'new';

interface CollectionLockPasswordDialogProps {
  readonly visible: boolean;
  readonly mode: CollectionLockPasswordDialogMode;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
  /** The server no longer considers the sign-in recent - the caller asks to sign in again. */
  readonly onSignInExpired: () => void;
}

/** Entered passwords live only in this dialog's state and are cleared whenever it opens. */
export function CollectionLockPasswordDialog({ visible, mode, onCancel, onSaved, onSignInExpired }: CollectionLockPasswordDialogProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const authenticatedRequest = useAuthenticatedApi();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setError(null);
    }
  }, [visible]);

  const save = async () => {
    if (isSubmitting) {
      return;
    }
    if (mode === 'change' && !currentPassword) {
      setError(t('collections.lockCurrentPasswordRequired'));
      return;
    }
    if (newPassword.length < LOCK_PASSWORD_MIN_LENGTH || newPassword.length > LOCK_PASSWORD_MAX_LENGTH) {
      setError(t('collections.lockPasswordRule', { min: LOCK_PASSWORD_MIN_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('collections.lockPasswordMismatch'));
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (mode === 'change') {
        await changeCollectionLockPassword(authenticatedRequest, currentPassword, newPassword, confirmPassword);
      } else {
        await resetCollectionLockPassword(authenticatedRequest, newPassword, confirmPassword);
      }
      onSaved();
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.code === RECENT_AUTHENTICATION_REQUIRED_CODE) {
        onSignInExpired();
      } else if (caughtError instanceof ApiError && caughtError.kind === 'forbidden' && caughtError.code === 'invalidCollectionPassword') {
        setError(t('collections.lockWrongCurrentPassword'));
      } else if (caughtError instanceof ApiError && caughtError.kind === 'tooManyRequests') {
        setError(t('collections.lockTooManyAttempts'));
      } else if (caughtError instanceof ApiError && caughtError.kind === 'badRequest') {
        setError(t('collections.lockPasswordRule', { min: LOCK_PASSWORD_MIN_LENGTH }));
      } else {
        setError(t('collections.lockSaveFallback'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const passwordField = (value: string, onChange: (next: string) => void, label: string, testID: string) => (
    <TextInput
      accessibilityLabel={label}
      autoCapitalize="none"
      autoComplete="off"
      autoCorrect={false}
      editable={!isSubmitting}
      maxLength={LOCK_PASSWORD_MAX_LENGTH}
      onChangeText={onChange}
      placeholder={label}
      secureTextEntry
      style={styles.input}
      testID={testID}
      value={value}
    />
  );

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={[styles.overlay, { paddingTop: spacing.xl + insets.top, paddingBottom: spacing.xl + insets.bottom }]}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={isSubmitting ? undefined : onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card} testID={`lock-password-dialog-${mode}`}>
          <Text style={styles.title}>
            {mode === 'change' ? t('settings.collectionLockChangePassword') : t('settings.collectionLockSetPassword')}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.message}>{t('collections.lockPasswordRule', { min: LOCK_PASSWORD_MIN_LENGTH })}</Text>
            {mode === 'change'
              ? passwordField(currentPassword, setCurrentPassword, t('settings.collectionLockCurrentPassword'), 'lock-password-current')
              : null}
            {passwordField(newPassword, setNewPassword, t('settings.collectionLockNewPassword'), 'lock-password-new')}
            {passwordField(confirmPassword, setConfirmPassword, t('settings.collectionLockConfirmPassword'), 'lock-password-confirm')}
            {error ? <Text style={styles.error} testID="lock-password-error">{error}</Text> : null}
          </ScrollView>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
              disabled={isSubmitting}
              onPress={save}
              style={styles.confirmButton}
              testID="lock-password-save"
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <Text numberOfLines={2} style={styles.confirmLabel}>{t('common.save')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    maxHeight: '100%',
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  message: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.md },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  cancelLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  confirmLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
