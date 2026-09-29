import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { KeyIcon } from '../icons/KeyIcon';
import { LockIcon } from '../icons/LockIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { unlockCollection } from './api/collectionsApi';
import { unlockSharePassword } from './api/sharePasswordApi';
import { rememberCollectionUnlock } from './collectionUnlockGrants';

export function getUnlockErrorMessage(error: unknown, t: TFunction, kind: 'lock' | 'sharePassword' = 'lock'): string {
  if (error instanceof ApiError) {
    if (error.kind === 'forbidden' && error.code === 'invalidCollectionPassword') {
      return t(kind === 'sharePassword' ? 'collections.sharePasswordWrong' : 'collections.lockWrongPassword');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collections.lockTooManyAttempts');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.lockUnlockFallback');
}

interface CollectionUnlockPanelProps {
  readonly collectionId: number;
  /** Called after the server accepted the password and the grant was stored - reload content then. */
  readonly onUnlocked: () => void;
  /**
   * When given, the grant goes to the caller (e.g. the Collection picker's own session) instead of
   * the Collection-visit store - it is never shared with anything else.
   */
  readonly onGranted?: (unlockToken: string, expiresAtUtc: string) => void;
  /**
   * The server-reported role. A member is told the Owner's lock password is needed; the Owner
   * manages (and can reset) theirs in Settings > 컬렉션 잠금.
   */
  readonly isOwner?: boolean;
  /**
   * Which password this panel asks for: 'lock' - the Owner's Collection lock password (the Owner,
   * or a member of a legacy Collection); 'sharePassword' - the Collection's own share password (a
   * member only). The two are never mixed up in wording or in what the server checks.
   */
  readonly kind?: 'lock' | 'sharePassword';
}

/**
 * Shown in place of a locked Collection's links. The server has sent none of them: content is only
 * requested again after the Owner's lock password is verified server-side and a short-lived grant is
 * stored in memory (see collectionUnlockGrants). The password is never stored or logged anywhere.
 */
export function CollectionUnlockPanel({ collectionId, onUnlocked, onGranted, isOwner = true, kind = 'lock' }: CollectionUnlockPanelProps) {
  const isSharePassword = kind === 'sharePassword';
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (isSubmitting || !password) {
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const grant = isSharePassword
        ? await unlockSharePassword(authenticatedRequest, collectionId, password)
        : await unlockCollection(authenticatedRequest, collectionId, password);
      if (onGranted) {
        onGranted(grant.unlockToken, grant.expiresAtUtc);
      } else {
        rememberCollectionUnlock(collectionId, grant.unlockToken, grant.expiresAtUtc);
      }
      setPassword('');
      onUnlocked();
    } catch (caughtError) {
      setError(getUnlockErrorMessage(caughtError, t, kind));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSubmitDisabled = isSubmitting || password.length === 0;

  return (
    <View style={styles.card} testID={isSharePassword ? 'collection-share-password-panel' : 'collection-unlock-panel'}>
      <View style={styles.iconCircle}>
        {isSharePassword ? <KeyIcon color={colors.textPrimary} size={22} /> : <LockIcon color={colors.textPrimary} size={22} />}
      </View>
      <Text style={styles.title}>{t(isSharePassword ? 'collections.sharePasswordLockedTitle' : 'collections.lockedTitle')}</Text>
      <Text style={styles.message}>{t(isSharePassword ? 'collections.sharePasswordLockedMessage' : 'collections.lockedMessage')}</Text>
      <TextInput
        accessibilityLabel={t(isSharePassword ? 'collections.sharePasswordLabel' : 'collections.lockPasswordLabel')}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        editable={!isSubmitting}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        placeholder={t(isSharePassword ? 'collections.sharePasswordLabel' : 'collections.lockPasswordLabel')}
        returnKeyType="done"
        secureTextEntry
        style={styles.input}
        testID="collection-unlock-password"
        value={password}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isSubmitDisabled, busy: isSubmitting }}
        disabled={isSubmitDisabled}
        onPress={submit}
        style={[styles.button, isSubmitDisabled && styles.buttonDisabled]}
        testID="collection-unlock-submit"
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.surface} size="small" />
        ) : (
          <Text style={styles.buttonLabel}>{t('collections.unlockAction')}</Text>
        )}
      </Pressable>
      {isOwner ? null : (
        <Text style={styles.hint} testID="collection-unlock-contact-owner">
          {t(isSharePassword ? 'collections.sharePasswordContactOwner' : 'collections.lockContactOwner')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'stretch',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    marginTop: spacing.lg,
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  iconCircle: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 48,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: minTouchTarget,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '700',
  },
});
