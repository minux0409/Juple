import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { removeCollectionLock, removeMemberCollectionLock, setCollectionLock, setMemberCollectionLock } from './api/collectionsApi';
import { getCollectionLockPasswordStatus } from './api/collectionLockPasswordApi';
import { forgetCollectionUnlock } from './collectionUnlockGrants';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';
import { KeyboardFieldScope } from '../components/keyboardToolbar';

/** Mirrors the backend CollectionLockPasswordPolicy (6-64 characters) - the server re-checks it. */
export const LOCK_PASSWORD_MIN_LENGTH = 6;
export const LOCK_PASSWORD_MAX_LENGTH = 64;

export const LOCK_PASSWORD_NOT_CONFIGURED_CODE = 'collectionLockPasswordNotConfigured';

export function getLockErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError) {
    if (error.kind === 'forbidden' && error.code === 'invalidCollectionPassword') {
      return t('collections.lockWrongPassword');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collections.lockTooManyAttempts');
    }
  }
  return t('collections.lockSaveFallback');
}

/**
 * Two separate Owner actions: "lock" (a confirmation - the Collection is protected by the Owner's
 * one lock password from Settings > 컬렉션 잠금, so nothing is typed here; without that password
 * the dialog offers to go set it instead) and "remove" (the lock password, verified by the server -
 * the Owner has no bypass). No per-Collection password exists any more.
 */
export type CollectionLockDialogMode = 'lock' | 'remove';

interface CollectionLockDialogProps {
  readonly visible: boolean;
  readonly collectionId: number;
  readonly mode: CollectionLockDialogMode;
  /**
   * A member locking a Collection that someone else owns: their PERSONAL lock (their own lock password, nobody else affected) instead of
   * the Owner's Collection lock. Same dialog, same words; only the requests differ.
   */
  readonly forMember?: boolean;
  readonly onCancel: () => void;
  /** Called after the server accepted the change; the caller reloads the Collection. */
  readonly onChanged: () => void;
  /** "설정하기" when the Owner has no lock password yet - the caller opens Settings > 컬렉션 잠금. */
  readonly onOpenSettings: () => void;
}

type LockReadiness = 'checking' | 'ready' | 'notConfigured';

/**
 * Owner-only lock actions (see CollectionLockDialogMode). Every change invalidates all outstanding
 * unlock grants server-side, including this device's own.
 */
export function CollectionLockDialog({ visible, collectionId, mode, forMember = false, onCancel, onChanged, onOpenSettings }: CollectionLockDialogProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const authenticatedRequest = useAuthenticatedApi();
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<LockReadiness>('checking');

  useEffect(() => {
    if (!visible) {
      return;
    }
    setPassword('');
    setError(null);
    if (mode !== 'lock') {
      return;
    }
    let isCurrent = true;
    setReadiness('checking');
    getCollectionLockPasswordStatus(authenticatedRequest)
      .then(status => {
        if (isCurrent) {
          setReadiness(status.isConfigured ? 'ready' : 'notConfigured');
        }
      })
      .catch(() => {
        // The lock call itself reports "not configured" too - offer it and let the server decide.
        if (isCurrent) {
          setReadiness('ready');
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [visible, mode, authenticatedRequest]);

  const run = async (action: () => Promise<void>) => {
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await action();
      forgetCollectionUnlock(collectionId);
      onChanged();
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.code === LOCK_PASSWORD_NOT_CONFIGURED_CODE) {
        setReadiness('notConfigured');
      } else {
        setError(getLockErrorMessage(caughtError, t));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirm = () => {
    if (mode === 'lock') {
      if (readiness === 'notConfigured') {
        onOpenSettings();
        return;
      }
      run(() => (forMember ? setMemberCollectionLock(authenticatedRequest, collectionId) : setCollectionLock(authenticatedRequest, collectionId)));
      return;
    }
    if (!password) {
      setError(t('collections.lockPasswordRequired'));
      return;
    }
    run(() => (forMember ? removeMemberCollectionLock(authenticatedRequest, collectionId, password) : removeCollectionLock(authenticatedRequest, collectionId, password)));
  };

  const isNotConfigured = mode === 'lock' && readiness === 'notConfigured';
  const isChecking = mode === 'lock' && readiness === 'checking';
  const title =
    mode === 'remove'
      ? t('collections.lockRemoveConfirmTitle')
      : isNotConfigured
        ? t('collections.lockSetTitle')
        : t('collections.lockConfirmTitle');
  const message =
    mode === 'remove'
      ? t('collections.lockRemoveConfirmMessage')
      : isNotConfigured
        ? t('collections.lockPasswordNotConfigured')
        : t('collections.lockConfirmMessage');
  const confirmLabel =
    mode === 'remove' ? t('collections.lockRemoveAction') : isNotConfigured ? t('collections.lockOpenSettings') : t('collections.lockSetTitle');

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <KeyboardFieldScope>
      <KeyboardSafeView style={[styles.overlay, { paddingTop: spacing.xl + insets.top, paddingBottom: spacing.xl + insets.bottom }]}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={isSubmitting ? undefined : onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card} testID={`lock-dialog-${isNotConfigured ? 'not-configured' : mode}`}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {isChecking ? <ActivityIndicator style={styles.checking} /> : <Text style={styles.message}>{message}</Text>}
            {mode === 'remove' ? (
              <ThemedTextInput
                accessibilityLabel={t('collections.lockPasswordLabel')}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                editable={!isSubmitting}
                maxLength={LOCK_PASSWORD_MAX_LENGTH}
                onChangeText={setPassword}
                placeholder={t('collections.lockPasswordLabel')}
                secureTextEntry
                style={styles.input}
                testID="lock-current-password"
                value={password}
              />
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting || isChecking, busy: isSubmitting }}
              disabled={isSubmitting || isChecking}
              onPress={confirm}
              style={[styles.confirmButton, mode === 'remove' && styles.destructiveButton, isChecking && styles.buttonDisabled]}
              testID={mode === 'remove' ? 'lock-remove' : isNotConfigured ? 'lock-open-settings' : 'lock-save'}
            >
              {isSubmitting ? (
                <ActivityIndicator color={mode === 'remove' ? colors.onDestructive : colors.onBrand} size="small" />
              ) : (
                <Text numberOfLines={2} style={[styles.confirmLabel, mode === 'remove' && styles.destructiveLabel]}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardSafeView>
      </KeyboardFieldScope>
    </Modal>
  );
}

const styles = themedStyles(() => ({
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
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  checking: {
    paddingVertical: spacing.md,
  },
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
  error: {
    color: colors.dangerText,
    fontSize: 14,
    marginTop: spacing.md,
  },
  // The app's one destructive look (see DialogActions): the destructive red with a white bold label.
  destructiveButton: {
    backgroundColor: colors.destructive,
  },
  destructiveLabel: {
    color: colors.onDestructive,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  // 취소 like every dialog's (see DialogActions): a light grey fill, no outline.
  cancelButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  cancelLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  confirmLabel: {
    color: colors.onBrand,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
}));
