import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { AppModal } from '../components/AppModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyIconButton } from '../components/CopyIconButton';
import { UserAvatar } from '../components/UserAvatar';
import { BlockIcon } from '../icons/BlockIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { EditIcon } from '../icons/EditIcon';
import { FlagIcon } from '../icons/FlagIcon';
import { UserMinusIcon } from '../icons/UserMinusIcon';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { FRIEND_NOTE_MAX_STORAGE_LENGTH, removeFriend, setFriendNote, type Friend } from './api/friendsApi';
import { blockUser } from '../safety/safetyApi';
import { ReportModal } from '../safety/ReportModal';
import { atJupleId } from './friendIdentity';

interface FriendDetailModalProps {
  readonly friend: Friend | null;
  readonly onClose: () => void;
  /** The server's updated friend after a saved note - the list shows it at once. */
  readonly onChanged: (friend: Friend) => void;
  readonly onRemoved: (friendshipId: number) => void;
  /** The person was blocked from here (the friendship ended with it): the list refreshes. */
  readonly onBlocked?: (friendshipId: number) => void;
}

/**
 * One friend, in Juple's standard centered modal: their photo, nickname and Juple ID, then the
 * signed-in user's own private note (내 메모 - never shown to the friend, saved only on 메모 저장),
 * then 친구 삭제 behind a confirmation. While saving, removing or confirming it cannot be dismissed by
 * accident; a failed save keeps both the typed text and the note the list still shows.
 */
export function FriendDetailModal({ friend, onClose, onChanged, onRemoved, onBlocked }: FriendDetailModalProps) {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRemoveConfirmVisible, setIsRemoveConfirmVisible] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [isBlockConfirmVisible, setIsBlockConfirmVisible] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const friendshipId = friend?.friendshipId;
  useEffect(() => {
    setNote(friend?.myNote ?? '');
    setError(null);
    // Only when another friend is opened - a saved note must not reset what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendshipId]);

  if (!friend) {
    return null;
  }

  const save = async () => {
    if (isSaving || isRemoving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      onChanged(await setFriendNote(authenticatedRequest, friend.friendshipId, note));
    } catch (caughtError) {
      setError(caughtError instanceof ApiError && caughtError.kind === 'badRequest' ? t('friends.noteInvalid') : t('friends.actionFallback'));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsRemoveConfirmVisible(false);
    if (isRemoving) {
      return;
    }
    setIsRemoving(true);
    setError(null);
    try {
      await removeFriend(authenticatedRequest, friend.friendshipId);
      onRemoved(friend.friendshipId);
    } catch {
      setError(t('friends.actionFallback'));
    } finally {
      setIsRemoving(false);
    }
  };

  const block = async () => {
    setIsBlockConfirmVisible(false);
    if (isBlocking) {
      return;
    }
    setIsBlocking(true);
    setError(null);
    try {
      await blockUser(authenticatedRequest, friend.jupleId);
      onBlocked?.(friend.friendshipId);
      onRemoved(friend.friendshipId);
    } catch {
      setError(t('safety.blockFailed'));
    } finally {
      setIsBlocking(false);
    }
  };

  const hasNickname = !!friend.displayName?.trim();
  const isBusy = isSaving || isRemoving || isBlocking;

  return (
    <>
      <AppModal
        dismissible={!isBusy && !isRemoveConfirmVisible}
        onClose={onClose}
        testID="friend-detail"
        title={t('friends.title')}
        visible
      >
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            <UserAvatar
              displayName={friend.displayName}
              imageUrl={friend.profileImageUrl}
              imageVersion={friend.profileImageVersion}
              jupleId={friend.jupleId}
              size={72}
            />
            {hasNickname ? <Text numberOfLines={2} style={styles.name}>{friend.displayName}</Text> : null}
            {/* The Juple ID with its copy button right beside it. Without a nickname the ID is the name. */}
            <View style={styles.idRow}>
              <Text numberOfLines={1} style={[hasNickname ? styles.jupleId : styles.nameLine, styles.idText, ltrTextStyle]} testID="friend-detail-juple-id">
                {atJupleId(friend.jupleId)}
              </Text>
              <CopyIconButton accessibilityLabel={t('profile.copyJupleId')} testID="friend-detail-copy-id" text={atJupleId(friend.jupleId)} />
            </View>
          </View>

          <View style={styles.divider} />

          {/* 메모: a neutral pencil with its word (the save button below keeps its check). */}
          <View style={styles.sectionTitleRow}>
            <EditIcon color={colors.textPrimary} size={ACTION_ICON_SIZE} />
            <Text style={styles.sectionTitle}>{t('friends.note')}</Text>
          </View>
          <TextInput
            accessibilityLabel={t('friends.note')}
            editable={!isBusy}
            maxLength={FRIEND_NOTE_MAX_STORAGE_LENGTH}
            onChangeText={setNote}
            style={styles.noteInput}
            testID="friend-note-input"
            value={note}
          />
          {error ? <Text style={styles.error} testID="friend-detail-error">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy, busy: isSaving }}
            disabled={isBusy}
            onPress={save}
            style={[styles.actionButton, styles.primaryButton, isBusy && !isSaving && styles.disabled]}
            testID="friend-note-save"
          >
            {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : (
              <>
                <CheckIcon color={colors.surface} size={ACTION_ICON_SIZE} />
                <Text numberOfLines={2} style={[styles.actionLabel, styles.primaryLabel]}>{t('friends.saveNote')}</Text>
              </>
            )}
          </Pressable>

          <View style={styles.divider} />

          {/* The app's secondary-destructive look (red outline, like 계정 삭제); the confirmation
              that follows carries the filled red button. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy, busy: isRemoving }}
            disabled={isBusy}
            onPress={() => setIsRemoveConfirmVisible(true)}
            style={[styles.actionButton, styles.removeButton, isBusy && !isRemoving && styles.disabled]}
            testID="friend-remove"
          >
            {isRemoving ? <ActivityIndicator color={colors.danger} size="small" /> : (
              <>
                <UserMinusIcon color={colors.danger} size={ACTION_ICON_SIZE} />
                <Text numberOfLines={2} style={[styles.actionLabel, styles.removeLabel]}>{t('friends.remove')}</Text>
              </>
            )}
          </Pressable>

          {/* 신고 / 차단: the other person's account - never shown for oneself (this modal is only ever a friend). */}
          <Pressable accessibilityRole="button" disabled={isBusy} onPress={() => setIsReporting(true)} style={[styles.actionButton, styles.safetyButton, isBusy && styles.disabled]} testID="friend-report">
            <FlagIcon color={colors.warningText} size={ACTION_ICON_SIZE} />
            <Text numberOfLines={2} style={[styles.actionLabel, styles.warningLabel]}>{t('safety.report')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={isBusy} onPress={() => setIsBlockConfirmVisible(true)} style={[styles.actionButton, styles.safetyButton, isBusy && styles.disabled]} testID="friend-block">
            {isBlocking ? <ActivityIndicator color={colors.danger} size="small" /> : (
              <>
                <BlockIcon color={colors.danger} size={ACTION_ICON_SIZE} />
                <Text numberOfLines={2} style={[styles.actionLabel, styles.removeLabel]}>{t('safety.block')}</Text>
              </>
            )}
          </Pressable>
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice} testID="friend-detail-notice">{notice}</Text> : null}
        </ScrollView>
      </AppModal>
      <ReportModal
        onClose={() => setIsReporting(false)}
        onReported={alreadyReported => {
          setIsReporting(false);
          setNotice(t(alreadyReported ? 'safety.reportAlready' : 'safety.reportReceived'));
        }}
        target={isReporting ? { type: 'User', jupleId: friend.jupleId } : null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('safety.block')}
        message={t('safety.blockMessage')}
        onCancel={() => setIsBlockConfirmVisible(false)}
        onConfirm={() => { block().catch(() => undefined); }}
        title={t('safety.blockTitle')}
        visible={isBlockConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('friends.remove')}
        message={t('friends.removeConfirmMessage')}
        onCancel={() => setIsRemoveConfirmVisible(false)}
        onConfirm={remove}
        title={t('friends.removeConfirmTitle')}
        visible={isRemoveConfirmVisible}
      />
    </>
  );
}

/** One icon size for every action (메모 / 메모 저장 / 친구 삭제 / 신고 / 차단). */
const ACTION_ICON_SIZE = 16;

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: 0, paddingTop: spacing.xs },
  name: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: spacing.sm, textAlign: 'center' },
  jupleId: { color: colors.textSecondary, fontSize: 14 },
  nameLine: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' },
  idRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', maxWidth: '100%' },
  idText: { flexShrink: 1 },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.lg },
  sectionTitle: { color: colors.textPrimary, flexShrink: 1, fontSize: 15, fontWeight: '700' },
  sectionTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + 2 },
  // Inside a modal's ScrollView: a plain full-width field (flex: 1 would collapse it in a column).
  noteInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    marginTop: spacing.sm,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  // 메모 저장 and 친구 삭제 share one button shape - [icon] text, the same height, radius, border width, padding and gap -
  // only the color says which is the default action and which is destructive.
  actionButton: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  actionLabel: { flexShrink: 1, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  primaryButton: { backgroundColor: colors.brand, borderColor: colors.brand, marginTop: spacing.md },
  primaryLabel: { color: colors.surface },
  disabled: { opacity: 0.45 },
  removeButton: { borderColor: colors.danger },
  safetyButton: { borderColor: colors.border, marginTop: spacing.sm },
  warningLabel: { color: colors.warningText },
  notice: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.sm, textAlign: 'center' },
  removeLabel: { color: colors.danger },
});
