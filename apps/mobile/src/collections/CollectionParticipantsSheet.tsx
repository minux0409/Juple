import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CrownIcon } from '../icons/CrownIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import {
  getCollectionParticipants,
  invitationRoleOf,
  participantRoleLabelKey,
  personLabel,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
} from './api/collaborationApi';
import { isCollectionLockedError } from './useCollectionItems';

interface CollectionParticipantsSheetProps {
  readonly visible: boolean;
  readonly collectionId: number;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly onClose: () => void;
  /** Called after a membership change, so the caller can refresh its summary/content. */
  readonly onChanged?: () => void;
  /**
   * The caller's unlock gate for managing a locked Collection (CollectionDetailsScreen.runUnlocked):
   * runs the action at once with a valid grant, otherwise asks for the password first and runs it
   * only after a successful unlock (never after a wrong password or a cancel). Without it, actions
   * run directly.
   */
  readonly runUnlocked?: (action: () => void) => void;
}

/**
 * Who is in a collaborative Category, opened from its participant summary. Every member sees the
 * same list (the Owner and accepted Contributors, by display name or Juple ID); only the Owner - as
 * the server reports via canManage - also sees pending invitations and the remove/cancel controls.
 * A Contributor's view is strictly read-only.
 */
export function CollectionParticipantsSheet({
  visible,
  collectionId,
  authenticatedRequest,
  onClose,
  onChanged,
  runUnlocked = action => action(),
}: CollectionParticipantsSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<CollectionParticipants | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ jupleId: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await getCollectionParticipants(authenticatedRequest, collectionId));
    } catch {
      setError(t('collections.participantsLoadFallback'));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, collectionId, t]);

  useEffect(() => {
    if (visible) {
      load();
    }
  }, [load, visible]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busyKey !== null) {
      return;
    }
    setBusyKey(key);
    setError(null);
    try {
      await action();
      await load();
      onChanged?.();
    } catch (caughtError) {
      // A grant that expired in the meantime: the server refused it; say so rather than a generic failure.
      setError(isCollectionLockedError(caughtError) ? t('collections.lockRequiredForAction') : t('collaboration.actionFallback'));
    } finally {
      setBusyKey(null);
    }
  };

  const canManage = data?.canManage === true;

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} testID="participants-sheet">
          <Text style={styles.title}>{t('collections.participantsTitle')}</Text>
          <ScrollView style={styles.list}>
            {isLoading && !data ? <ActivityIndicator style={styles.loading} /> : null}
            {data?.participants.map(participant => (
              <View key={participant.jupleId} style={styles.row} testID={`participants-sheet-${participant.jupleId}`}>
                <View style={styles.rowText}>
                  <View style={styles.nameRow}>
                    {participant.role === 'owner' ? <OwnerCrown /> : null}
                    <Text numberOfLines={1} style={[styles.name, styles.nameText]}>
                      {participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant)}
                    </Text>
                  </View>
                  <Text style={styles.role}>{t(participantRoleLabelKey(participant.role))}</Text>
                </View>
                {canManage && participant.role !== 'owner' ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyKey !== null}
                    onPress={() => setPendingRemoval({ jupleId: participant.jupleId })}
                    style={styles.action}
                    testID={`participants-sheet-remove-${participant.jupleId}`}
                  >
                    <Text style={styles.removeLabel}>{t('collaboration.remove')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {canManage && data && data.pendingInvitations.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('collaboration.pendingCollaborationTitle')}</Text>
                {data.pendingInvitations.map(invitation => (
                  <View key={invitation.invitationId} style={styles.row} testID={`participants-sheet-pending-${invitation.invitationId}`}>
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.name}>{personLabel(invitation)}</Text>
                      <Text style={styles.role}>{t(participantRoleLabelKey(invitationRoleOf(invitation.role)))}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busyKey !== null}
                      onPress={() =>
                        runUnlocked(() =>
                          runAction(`revoke-${invitation.invitationId}`, () =>
                            revokeCollectionInvitation(authenticatedRequest, collectionId, invitation.invitationId)))
                      }
                      style={styles.action}
                      testID={`participants-sheet-revoke-${invitation.invitationId}`}
                    >
                      <Text style={styles.actionLabel}>{t('collaboration.revoke')}</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeLabel}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collaboration.remove')}
        message={t('collaboration.removeConfirmMessage')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const target = pendingRemoval;
          setPendingRemoval(null);
          if (target) {
            runUnlocked(() =>
              runAction(`remove-${target.jupleId}`, () => removeCollaborator(authenticatedRequest, collectionId, target.jupleId)));
          }
        }}
        title={t('collaboration.removeConfirmTitle')}
        visible={pendingRemoval !== null}
      />
    </Modal>
  );
}

/**
 * The Owner marker next to a name: a vector crown (never an emoji, whose glyph differs per platform),
 * decorative only - the role line under the name already says 소유자 to assistive technology.
 */
export function OwnerCrown() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="participant-owner-crown">
      <CrownIcon color={colors.warning} size={16} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  nameText: { flexShrink: 1 },
  overlay: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '75%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '100%',
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  loading: { paddingVertical: spacing.lg },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  role: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  action: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.sm },
  actionLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  removeLabel: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  close: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.sm, minHeight: minTouchTarget, justifyContent: 'center' },
  closeLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
});
