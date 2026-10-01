import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { UserAvatar } from '../components/UserAvatar';
import { FriendPickerModal, type FriendUnavailableReason } from '../friends/FriendPickerModal';
import { CloseIcon } from '../icons/CloseIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { formatJupleId, lookupJupleId, personLabel } from './api/collaborationApi';
import { MAX_LINK_SHARE_RECIPIENTS, sendCollectionShareLink } from './api/collectionsApi';

/** Someone the link is about to be sent to - picked from friends or found by Juple ID. */
interface Recipient {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl: string | null;
  readonly profileImageVersion: string | null;
  /** Set when the server could not send to them (the ID belongs to nobody any more). */
  readonly error: string | null;
}

type Mode = 'friends' | 'id';

interface CollectionLinkShareSheetProps {
  readonly visible: boolean;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly collectionId: number;
  readonly onClose: () => void;
  /** 외부 공유: the OS share sheet with the public URL (the caller fetched it fresh just before opening this). */
  readonly onShareExternally: () => void;
  /** Sent to these many people - the caller closes the sheet and says so. */
  readonly onSent: (count: number) => void;
  /** The public link was turned off meanwhile - nothing was sent; the caller closes and hides sharing. */
  readonly onLinkInactive: () => void;
}

const normalizeJupleId = (value: string) => value.replace(/[\s-]/g, '').toUpperCase();

/**
 * 컬렉션 링크 공유 for a member (not the Owner): passes the Owner's public link on - to friends, to
 * people by Juple ID (as a Juple notification), or anywhere through the OS share sheet. It never
 * invites anyone into the Collection: the recipient just gets the public link, with its own password
 * gate. Friends and IDs collect into one list (each person once, at most MAX_LINK_SHARE_RECIPIENTS),
 * sent in one request; the server re-checks that the link is still public when it sends.
 */
export function CollectionLinkShareSheet({
  visible,
  authenticatedRequest,
  collectionId,
  onClose,
  onShareExternally,
  onSent,
  onLinkInactive,
}: CollectionLinkShareSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('friends');
  const [recipients, setRecipients] = useState<readonly Recipient[]>([]);
  const [isPickingFriends, setIsPickingFriends] = useState(false);
  const [idInput, setIdInput] = useState('');
  const [idError, setIdError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Every opening starts clean.
  useEffect(() => {
    if (visible) {
      setMode('friends');
      setRecipients([]);
      setIdInput('');
      setIdError(null);
      setSendError(null);
    }
  }, [visible]);

  const hasRoomFor = (count: number) => {
    if (recipients.length + count > MAX_LINK_SHARE_RECIPIENTS) {
      setSendError(t('linkShare.limit', { max: MAX_LINK_SHARE_RECIPIENTS }));
      return false;
    }
    return true;
  };

  const addFriends = (picked: readonly { jupleId: string; displayName: string | null; profileImageUrl?: string | null; profileImageVersion?: string | null }[]) => {
    setIsPickingFriends(false);
    const fresh = picked.filter(friend => !recipients.some(recipient => recipient.jupleId === friend.jupleId));
    if (!hasRoomFor(fresh.length)) {
      return;
    }
    setSendError(null);
    setRecipients(previous => [
      ...previous,
      ...fresh.map(friend => ({
        jupleId: friend.jupleId,
        displayName: friend.displayName,
        profileImageUrl: friend.profileImageUrl ?? null,
        profileImageVersion: friend.profileImageVersion ?? null,
        error: null,
      })),
    ]);
  };

  /** "추가": the Juple ID is checked (exists, not oneself, not already listed) before it joins the list. */
  const addById = async () => {
    const jupleId = normalizeJupleId(idInput);
    if (!jupleId || isLookingUp) {
      return;
    }
    if (recipients.some(recipient => recipient.jupleId === jupleId)) {
      setIdError(t('shareSheet.duplicateInvitee'));
      return;
    }
    if (!hasRoomFor(1)) {
      return;
    }
    setIsLookingUp(true);
    setIdError(null);
    try {
      const found = await lookupJupleId(authenticatedRequest, jupleId);
      if (found.isSelf) {
        setIdError(t('linkShare.cannotSendSelf'));
        return;
      }
      setRecipients(previous => previous.some(recipient => recipient.jupleId === found.jupleId)
        ? previous
        : [...previous, {
          jupleId: found.jupleId,
          displayName: found.displayName ?? null,
          profileImageUrl: found.profileImageUrl ?? null,
          profileImageVersion: found.profileImageVersion ?? null,
          error: null,
        }]);
      setIdInput('');
    } catch (caughtError) {
      setIdError(
        caughtError instanceof ApiError && caughtError.kind === 'notFound'
          ? t('collaboration.lookupNotFound')
          : caughtError instanceof ApiError && caughtError.kind === 'tooManyRequests'
            ? t('collaboration.tooManyRequests')
            : t('collaboration.lookupFallback'),
      );
    } finally {
      setIsLookingUp(false);
    }
  };

  const send = async () => {
    if (recipients.length === 0 || isSending) {
      return;
    }
    setIsSending(true);
    setSendError(null);
    try {
      const result = await sendCollectionShareLink(authenticatedRequest, collectionId, recipients.map(recipient => recipient.jupleId));
      if (result.notFound.length === 0) {
        onSent(result.sent.length);
        return;
      }
      // Some IDs belong to nobody any more: those stay listed with their reason; the rest were sent.
      const notFound = new Set(result.notFound.map(normalizeJupleId));
      setRecipients(previous => previous
        .filter(recipient => notFound.has(recipient.jupleId))
        .map(recipient => ({ ...recipient, error: t('collaboration.lookupNotFound') })));
      if (result.sent.length > 0) {
        setSendError(t('linkShare.sent', { count: result.sent.length }));
      }
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'conflict' && caughtError.code === 'publicLinkInactive') {
        onLinkInactive();
        return;
      }
      setSendError(
        caughtError instanceof ApiError && caughtError.kind === 'tooManyRequests'
          ? t('collaboration.tooManyRequests')
          : t('linkShare.sendError'),
      );
    } finally {
      setIsSending(false);
    }
  };

  const unavailable = new Map<string, FriendUnavailableReason>(recipients.map(recipient => [recipient.jupleId, 'added']));

  return (
    <>
      {/* No slide-up: the chooser appears at once (a window-wide slide would drag the dim backdrop up
          with it, drawing the eye to motion that shouldn't be there). */}
      <Modal
        animationType="none"
        onRequestClose={onClose}
        transparent
        // Steps aside while the friend picker is up (one modal at a time on iOS), and comes back with
        // everything as it was.
        visible={visible && !isPickingFriends}
      >
        <View style={styles.backdrop}>
          <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onClose} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} testID="link-share-sheet">
            <View style={styles.headerRow}>
              <Text style={styles.title}>{t('shareSheet.shareLink')}</Text>
              <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.iconButton} testID="link-share-close">
                <CloseIcon color={colors.textSecondary} size={20} />
              </Pressable>
            </View>

            {/* [친구] [ID] choose who gets it inside Juple; [외부 공유] hands the link to the OS share sheet. */}
            <View accessibilityRole="tablist" style={styles.modes}>
              {(['friends', 'id'] as const).map(option => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === option }}
                  key={option}
                  onPress={() => setMode(option)}
                  style={[styles.mode, mode === option && styles.modeSelected]}
                  testID={`link-share-mode-${option}`}
                >
                  <Text numberOfLines={1} style={[styles.modeLabel, mode === option && styles.modeLabelSelected]}>
                    {option === 'friends' ? t('shareSheet.inviteTabFriends') : t('shareSheet.inviteTabId')}
                  </Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={onShareExternally} style={styles.mode} testID="link-share-external">
                <ShareIcon color={colors.textSecondary} size={16} />
                <Text numberOfLines={1} style={styles.modeLabel}>{t('linkShare.external')}</Text>
              </Pressable>
            </View>

            {mode === 'friends' ? (
              <Pressable accessibilityRole="button" onPress={() => setIsPickingFriends(true)} style={styles.secondaryButton} testID="link-share-choose-friends">
                <Text style={styles.secondaryLabel}>{t('shareSheet.chooseFriends')}</Text>
              </Pressable>
            ) : (
              <View>
                <View style={styles.idRow}>
                  <TextInput
                    accessibilityLabel={t('shareSheet.inviteTabId')}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    onChangeText={value => {
                      setIdInput(value);
                      setIdError(null);
                    }}
                    onSubmitEditing={() => {
                      addById().catch(() => undefined);
                    }}
                    placeholder={t('collaboration.jupleIdPlaceholder')}
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.input, ltrTextStyle]}
                    testID="link-share-id-input"
                    value={idInput}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: idInput.trim().length === 0 || isLookingUp, busy: isLookingUp }}
                    disabled={idInput.trim().length === 0 || isLookingUp}
                    onPress={() => {
                      addById().catch(() => undefined);
                    }}
                    style={[styles.addButton, (idInput.trim().length === 0 || isLookingUp) && styles.disabled]}
                    testID="link-share-id-add"
                  >
                    {isLookingUp ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.addLabel}>{t('sharedCollection.addAction')}</Text>}
                  </Pressable>
                </View>
                {idError ? <Text style={styles.error} testID="link-share-id-error">{idError}</Text> : null}
              </View>
            )}

            {recipients.length > 0 ? (
              <>
                <Text style={styles.count}>{t('shareSheet.selectedCount', { count: recipients.length })}</Text>
                <ScrollView style={styles.list}>
                  {recipients.map(recipient => (
                    <View key={recipient.jupleId} style={styles.row} testID={`link-share-recipient-${recipient.jupleId}`}>
                      <UserAvatar
                        displayName={recipient.displayName}
                        imageUrl={recipient.profileImageUrl}
                        imageVersion={recipient.profileImageVersion}
                        jupleId={recipient.jupleId}
                        size={32}
                      />
                      <View style={styles.rowText}>
                        <Text numberOfLines={1} style={styles.name}>{personLabel(recipient)}</Text>
                        {recipient.error ? (
                          <Text style={styles.error} testID={`link-share-recipient-error-${recipient.jupleId}`}>{recipient.error}</Text>
                        ) : recipient.displayName ? (
                          <Text numberOfLines={1} style={[styles.jupleId, ltrTextStyle]}>{formatJupleId(recipient.jupleId)}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityLabel={t('linkShare.removeRecipientA11y', { name: personLabel(recipient) })}
                        accessibilityRole="button"
                        disabled={isSending}
                        onPress={() => setRecipients(previous => previous.filter(entry => entry.jupleId !== recipient.jupleId))}
                        style={styles.iconButton}
                        testID={`link-share-remove-${recipient.jupleId}`}
                      >
                        <CloseIcon color={colors.textSecondary} size={16} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {sendError ? <Text style={styles.error} testID="link-share-error">{sendError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: recipients.length === 0 || isSending, busy: isSending }}
              disabled={recipients.length === 0 || isSending}
              onPress={() => {
                send().catch(() => undefined);
              }}
              style={[styles.primaryButton, (recipients.length === 0 || isSending) && styles.disabled]}
              testID="link-share-send"
            >
              {isSending ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text numberOfLines={2} style={styles.primaryLabel}>{t('linkShare.send', { count: recipients.length })}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
      <FriendPickerModal
        authenticatedRequest={authenticatedRequest}
        onClose={() => setIsPickingFriends(false)}
        onConfirm={addFriends}
        unavailable={unavailable}
        visible={visible && isPickingFriends}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    gap: spacing.md,
    maxHeight: '85%',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  modes: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md + 2, flexDirection: 'row', gap: 2, padding: 2 },
  mode: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: minTouchTarget - 6,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  modeSelected: { backgroundColor: colors.surface },
  modeLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  modeLabelSelected: { color: colors.textPrimary, fontWeight: '700' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  idRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  input: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  addLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  count: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  list: { flexGrow: 0, maxHeight: 240 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minHeight: minTouchTarget },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  jupleId: { color: colors.textSecondary, fontSize: 12 },
  error: { color: colors.danger, fontSize: 13, marginTop: 2 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
