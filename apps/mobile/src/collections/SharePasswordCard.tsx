import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, AppState, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EyeIcon } from '../icons/EyeIcon';
import { EyeOffIcon } from '../icons/EyeOffIcon';
import { KeyIcon } from '../icons/KeyIcon';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import {
  getSharePasswordStatus,
  removeSharePassword,
  revealSharePassword,
  setSharePassword,
  type SharePasswordMode,
  type SharePasswordStatus,
} from './api/sharePasswordApi';
import { beginCollectionVisit } from './collectionUnlockGrants';
import { CollectionUnlockPanel } from './CollectionUnlockPanel';
import { isCollectionLockedError } from './useCollectionItems';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';

/** One dot per character while the password is hidden. */
const PASSWORD_MASK = '•';

/** Mirrors the server's CollectionSharePasswordPolicy: 4-64 characters, no control characters, no surrounding spaces. */
export const SHARE_PASSWORD_MIN_LENGTH = 4;
export const SHARE_PASSWORD_MAX_LENGTH = 64;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** The server's policy, checked before asking it. The Owner types it once in plain view - no confirmation field. */
export function validateSharePassword(password: string, t: TFunction): string | null {
  const normalized = password.normalize('NFC');
  if (
    normalized.length < SHARE_PASSWORD_MIN_LENGTH
    || normalized.length > SHARE_PASSWORD_MAX_LENGTH
    || CONTROL_CHARACTER.test(normalized)
    || normalized.trim() !== normalized
  ) {
    return t('collections.sharePasswordPolicy', { min: SHARE_PASSWORD_MIN_LENGTH, max: SHARE_PASSWORD_MAX_LENGTH });
  }
  return null;
}

function getErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('collections.sharePasswordPolicy', { min: SHARE_PASSWORD_MIN_LENGTH, max: SHARE_PASSWORD_MAX_LENGTH });
    }
    if (error.kind === 'conflict' && error.code === 'sharePasswordUnreadable') {
      return t('collections.sharePasswordUnreadable');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.sharePasswordFallback');
}

interface SharePasswordCardProps {
  readonly collectionId: number;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  /** Every mode the card learns (loaded, set, removed) - the Share screen holds new sharing back while it is legacyCommonLock. */
  readonly onModeChange?: (mode: SharePasswordMode) => void;
}

/**
 * 공유 비밀번호 on the Owner's Share screen - one setting for every way the Collection is shared
 * (모든 사용자, invited friends, existing members). Separate from the Owner's Collection lock (Settings >
 * 컬렉션 잠금): the Owner is never asked for this one, recipients never for the lock.
 *
 * The switch is the only on/off control: on asks for a password, off (after a confirmation) removes
 * the protection - the sharing itself stays. While it is on, the password is shown masked (••••) until
 * the Owner taps the eye; 복사 copies the real password either way. Each visit and each return to the
 * foreground starts masked again. To have it at all, each time this screen is focused, the card asks the owner-only reveal endpoint for it (the general
 * status response never carries it) and holds it in component state only - never stored, logged or
 * reported - and drops it as soon as the screen loses focus or the app leaves the foreground
 * (background/inactive); back in the foreground on this same screen, it is revealed again. A reveal
 * that answers after any of that is dropped (request generation). A locked Collection still needs the
 * Owner's lock first: without this visit's lock grant the server refuses the reveal, and the card
 * asks for the lock password right here (the same prompt as the Collection itself), then reveals.
 */
export function SharePasswordCard({ collectionId, authenticatedRequest, onModeChange }: SharePasswordCardProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SharePasswordStatus | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'save' | 'remove' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [needsLockUnlock, setNeedsLockUnlock] = useState(false);
  const [dialog, setDialog] = useState<'set' | 'change' | null>(null);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);
  // Shown in plain text only after the eye is tapped - display only; the password itself is held
  // (and dropped) exactly as below either way.
  const [isRevealed, setIsRevealed] = useState(false);
  // Only a focused screen of an app in the foreground may hold the password. Every reveal carries a
  // generation; losing focus, leaving the foreground or saving a new password starts a new one, so an
  // answer that arrives after any of that is dropped instead of bringing the password back.
  const isFocusedRef = useRef(false);
  const isAppActiveRef = useRef(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const revealGenerationRef = useRef(0);
  const canShowPassword = () => isFocusedRef.current && isAppActiveRef.current;

  const forgetPassword = useCallback(() => {
    revealGenerationRef.current += 1;
    setPassword(null);
    setIsRevealed(false);
  }, []);

  // A lock grant entered here is kept only while this screen (or the Collection itself) is open.
  useEffect(() => beginCollectionVisit(collectionId), [collectionId]);

  const handleError = useCallback((caughtError: unknown) => {
    if (!isFocusedRef.current) {
      return;
    }
    if (isCollectionLockedError(caughtError)) {
      setNeedsLockUnlock(true);
    }
    setError(getErrorMessage(caughtError, t));
  }, [t]);

  const loadAndReveal = useCallback(async () => {
    const generation = ++revealGenerationRef.current;
    setBusy('load');
    try {
      const loaded = await getSharePasswordStatus(authenticatedRequest, collectionId);
      if (!isFocusedRef.current) {
        return;
      }
      setStatus(loaded);
      setError(null);
      if (loaded.mode === 'perCollection' && generation === revealGenerationRef.current && isAppActiveRef.current) {
        const revealed = await revealSharePassword(authenticatedRequest, collectionId);
        if (generation === revealGenerationRef.current && isFocusedRef.current && isAppActiveRef.current) {
          setPassword(revealed);
          setNeedsLockUnlock(false);
        }
      }
    } catch (caughtError) {
      handleError(caughtError);
    } finally {
      if (isFocusedRef.current) {
        setBusy(null);
      }
    }
  }, [authenticatedRequest, collectionId, handleError]);

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      loadAndReveal();
      return () => {
        isFocusedRef.current = false;
        forgetPassword();
      };
    }, [forgetPassword, loadAndReveal]),
  );

  // Leaving the foreground (background, or iOS inactive - the app switcher) drops the password at
  // once; coming back to this same, still-focused screen reveals it again. Blurred: nothing is asked.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        isAppActiveRef.current = false;
        forgetPassword();
        return;
      }
      if (isAppActiveRef.current) {
        return;
      }
      isAppActiveRef.current = true;
      if (isFocusedRef.current) {
        loadAndReveal();
      }
    });
    return () => subscription.remove();
  }, [forgetPassword, loadAndReveal]);

  const loadedMode = status?.mode;
  useEffect(() => {
    if (loadedMode) {
      onModeChange?.(loadedMode);
    }
  }, [loadedMode, onModeChange]);

  /**
   * Copies the real password, masked or shown - the password itself is never logged, reported or put
   * in any message. No toast of its own: the OS already says "copied" (as with the Juple ID). A
   * platform refusal only says so - it never shows the password and never breaks the screen.
   */
  const copy = () => {
    if (password === null) {
      return;
    }
    try {
      Clipboard.setString(password);
      setError(null);
    } catch {
      // Only a short reason - it stays masked until the Owner taps the eye.
      setError(t('collections.sharePasswordCopyFailed'));
    }
  };

  const save = async (typed: string): Promise<string | null> => {
    const normalized = typed.normalize('NFC');
    // A reveal of the previous password still on its way must not land over the new one.
    const generation = ++revealGenerationRef.current;
    setBusy('save');
    try {
      const saved = await setSharePassword(authenticatedRequest, collectionId, normalized);
      if (isFocusedRef.current) {
        setStatus(saved);
        // Exactly what the server now holds - no need to ask for it back (unless the app went to the
        // background meanwhile; the return to the foreground reveals it then).
        if (generation === revealGenerationRef.current && canShowPassword()) {
          setPassword(normalized);
        }
        setDialog(null);
        setError(null);
      }
      return null;
    } catch (caughtError) {
      if (isCollectionLockedError(caughtError) && isFocusedRef.current) {
        setDialog(null);
        setNeedsLockUnlock(true);
        setError(getErrorMessage(caughtError, t));
        return null;
      }
      return getErrorMessage(caughtError, t);
    } finally {
      if (isFocusedRef.current) {
        setBusy(null);
      }
    }
  };

  const remove = async () => {
    setBusy('remove');
    setError(null);
    try {
      const removed = await removeSharePassword(authenticatedRequest, collectionId);
      if (isFocusedRef.current) {
        setStatus(removed);
        setPassword(null);
      }
    } catch (caughtError) {
      handleError(caughtError);
    } finally {
      if (isFocusedRef.current) {
        setBusy(null);
      }
    }
  };

  const mode = status?.mode ?? 'none';
  const isDisabled = busy !== null;

  return (
    <View style={styles.card} testID="share-password-card">
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <KeyIcon color={colors.textSecondary} size={16} />
        </View>
        <Text accessibilityRole="header" style={styles.title}>{t('collections.sharePasswordTitle')}</Text>
        {status ? (
          <Switch
            accessibilityLabel={t('collections.sharePasswordToggle')}
            disabled={isDisabled}
            onValueChange={value => {
              if (value) {
                setDialog('set');
              } else {
                setIsRemoveConfirmVisible(true);
              }
            }}
            testID="share-password-toggle"
            value={mode !== 'none'}
          />
        ) : null}
      </View>
      <Text style={styles.help}>{t('collections.sharePasswordDescription')}</Text>

      {busy === 'load' && !status ? <ActivityIndicator style={styles.loading} /> : null}

      {needsLockUnlock ? (
        <View testID="share-password-lock-unlock">
          <CollectionUnlockPanel
            collectionId={collectionId}
            isOwner
            kind="lock"
            onUnlocked={() => {
              setNeedsLockUnlock(false);
              setError(null);
              loadAndReveal();
            }}
          />
        </View>
      ) : null}

      {mode === 'legacyCommonLock' ? (
        <View style={styles.notice} testID="share-password-legacy">
          <Text style={styles.noticeText}>{t('collections.sharePasswordLegacyNotice')}</Text>
          <View style={styles.actions}>
            <ActionButton disabled={isDisabled} label={t('collections.sharePasswordSetNew')} onPress={() => setDialog('set')} primary testID="share-password-set-new" />
          </View>
        </View>
      ) : null}

      {mode === 'perCollection' && !needsLockUnlock ? (
        <View style={styles.enabled} testID="share-password-enabled">
          <View style={styles.valueBox}>
            <View style={styles.valueSlot}>
              {password !== null ? (
                <Text numberOfLines={1} selectable={isRevealed} style={[styles.value, ltrTextStyle]} testID="share-password-value">
                  {isRevealed ? password : PASSWORD_MASK.repeat(password.length)}
                </Text>
              ) : (
                <ActivityIndicator size="small" testID="share-password-value-loading" />
              )}
            </View>
            <Pressable
              accessibilityLabel={t(isRevealed ? 'collections.sharePasswordHide' : 'collections.sharePasswordShow')}
              accessibilityRole="button"
              disabled={password === null}
              onPress={() => setIsRevealed(previous => !previous)}
              style={styles.eyeButton}
              testID="share-password-visibility"
            >
              {isRevealed ? <EyeIcon color={colors.textSecondary} size={20} /> : <EyeOffIcon color={colors.textSecondary} size={20} />}
            </Pressable>
          </View>
          <View style={styles.actions}>
            <ActionButton disabled={isDisabled || password === null} label={t('collections.sharePasswordCopy')} onPress={copy} primary testID="share-password-copy" />
            <ActionButton disabled={isDisabled} label={t('collections.sharePasswordChange')} onPress={() => setDialog('change')} testID="share-password-change" />
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.error} testID="share-password-error">{error}</Text> : null}

      <SharePasswordDialog
        isSaving={busy === 'save'}
        mode={dialog}
        onCancel={() => setDialog(null)}
        onSubmit={save}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.sharePasswordRemove')}
        destructive
        message={t('collections.sharePasswordRemoveMessage')}
        onCancel={() => setIsRemoveConfirmVisible(false)}
        onConfirm={() => {
          setIsRemoveConfirmVisible(false);
          remove();
        }}
        title={t('collections.sharePasswordRemoveTitle')}
        visible={isRemoveConfirmVisible}
      />
    </View>
  );
}

function ActionButton({ label, onPress, disabled, primary = false, testID }: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled: boolean;
  readonly primary?: boolean;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, primary && styles.actionButtonPrimary, disabled && styles.disabled]}
      testID={testID}
    >
      <Text numberOfLines={2} style={[styles.actionLabel, primary && styles.actionLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

interface SharePasswordDialogProps {
  /** 'set' - the first time (or replacing a legacy protection); 'change' - a new password; null = closed. */
  readonly mode: 'set' | 'change' | null;
  readonly isSaving: boolean;
  /** Resolves with an error message to show, or null when it was saved (the dialog then closes). */
  readonly onSubmit: (password: string) => Promise<string | null>;
  readonly onCancel: () => void;
}

/**
 * Enter the share password once, in plain view (the Owner can always see it anyway) - the typed value
 * lives only in this dialog and is cleared on close. Android's visible-password keyboard keeps it out
 * of the keyboard's suggestions and learned words.
 */
function SharePasswordDialog({ mode, isSaving, onSubmit, onCancel }: SharePasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
  }, [mode]);

  const submit = async () => {
    if (isSaving) {
      return;
    }
    const validationError = validateSharePassword(password, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(await onSubmit(password));
  };

  const label = t(mode === 'change' ? 'collections.sharePasswordChangeLabel' : 'collections.sharePasswordNewLabel');

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={mode !== null}>
      <KeyboardSafeView style={styles.overlay}>
        <View style={styles.dialog} testID="share-password-dialog">
          <Text accessibilityRole="header" style={styles.dialogTitle}>
            {t(mode === 'change' ? 'collections.sharePasswordChangeTitle' : 'collections.sharePasswordSetTitle')}
          </Text>
          <TextInput
            accessibilityLabel={label}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!isSaving}
            importantForAutofill="no"
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            maxLength={SHARE_PASSWORD_MAX_LENGTH}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            placeholder={label}
            secureTextEntry={false}
            spellCheck={false}
            style={[styles.input, ltrTextStyle]}
            testID="share-password-input"
            value={password}
          />
          <Text style={styles.help}>{t('collections.sharePasswordPolicy', { min: SHARE_PASSWORD_MIN_LENGTH, max: SHARE_PASSWORD_MAX_LENGTH })}</Text>
          {error ? <Text style={styles.error} testID="share-password-dialog-error">{error}</Text> : null}
          <View style={styles.dialogActions}>
            <Pressable accessibilityRole="button" disabled={isSaving} onPress={onCancel} style={styles.actionButton} testID="share-password-cancel">
              <Text style={styles.actionLabel}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving, busy: isSaving }}
              disabled={isSaving}
              onPress={submit}
              style={[styles.actionButton, styles.actionButtonPrimary]}
              testID="share-password-submit"
            >
              {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : (
                <Text style={[styles.actionLabel, styles.actionLabelPrimary]}>{t('collections.sharePasswordSubmit')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardSafeView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // The Share screen's own compact section card (a light 1px outline), one of its four equal cards.
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  headerIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 24, justifyContent: 'center', width: 24 },
  title: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 15, fontWeight: '600' },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  loading: { paddingVertical: spacing.sm },
  notice: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, gap: spacing.sm, padding: spacing.md },
  noticeText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  enabled: { gap: spacing.sm },
  // One line: the (masked) password, then the eye. The same height hidden or shown.
  valueBox: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: 'row', minHeight: minTouchTarget, paddingStart: spacing.md },
  valueSlot: { flex: 1, justifyContent: 'center', minWidth: 0 },
  value: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 1 },
  eyeButton: { alignItems: 'center', flexShrink: 0, height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  // Wraps onto more lines on a narrow screen (360dp PDA, large font) instead of overflowing.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 88,
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  actionButtonPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  actionLabelPrimary: { color: colors.surface, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, fontSize: 13 },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: spacing.sm, maxWidth: 420, padding: spacing.xl, width: '100%' },
  dialogTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  dialogActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
});
