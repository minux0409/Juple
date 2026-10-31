import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { CloseButton } from '../components/CloseButton';
import { ImportantState } from '../components/ImportantState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { UserAvatar } from '../components/UserAvatar';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { usePersonProfile } from '../friends/PersonProfileModal';
import { BlockIcon } from '../icons/BlockIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { useBlockPersonFlow, type BlockSubject } from '../safety/useBlockPersonFlow';
import { OwnerCrown } from './OwnerCrown';
import { ParticipantGrid, type ParticipantTileData } from './ParticipantGrid';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference } from '../settings/viewModePreference';
import { colors, ltrTextStyle, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
import {
  formatJupleId,
  getCollectionParticipants,
  invitationRoleOf,
  participantRoleLabelKey,
  personLabel,
  type CollectionParticipants,
} from './api/collaborationApi';

interface CollectionParticipantsSheetProps {
  readonly visible: boolean;
  readonly collectionId: number;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly onClose: () => void;
  /**
   * The participant list the caller already holds (the avatar stack's source). The sheet opens with
   * it - its first frame is already the final size - and only revalidates in the background, instead
   * of opening as a title + spinner and then jumping to the full list when the request returns.
   */
  readonly initialData?: CollectionParticipants | null;
}

/**
 * Who is in a collaborative Category, opened from its participant summary. Every member sees the
 * same list (the Owner and accepted Contributors, by display name or Juple ID); only the Owner - as
 * the server reports via canManage - also sees pending invitations. VIEW-ONLY for everyone: the popup is for seeing
 * who is in and opening their profile / friend information; removing someone or cancelling an invitation lives only
 * on the Share screen (the dedicated management place).
 */
export function CollectionParticipantsSheet({
  visible,
  collectionId,
  authenticatedRequest,
  onClose,
  initialData = null,
}: CollectionParticipantsSheetProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<CollectionParticipants | null>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An avatar tap inspects the person (self / friend / non-friend, resolved before anything opens).
  const { openProfile, profileModal } = usePersonProfile();
  // A participant's "⋯" (never on my own row): 사용자 차단. Blocking changes nobody's membership, so the list stays as it is.
  const [menuPerson, setMenuPerson] = useState<BlockSubject | null>(null);
  const { requestBlock, blockDialogs } = useBlockPersonFlow();
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const moreLabel = (name: string) => t('shareSheet.memberActionsA11y', { name });

  // The caller's list can arrive after this component mounted (it is mounted with the screen).
  useEffect(() => {
    if (initialData) {
      setData(previous => previous ?? initialData);
    }
  }, [initialData]);

  // With a list already on screen the reload is silent (no spinner, no layout change until it differs).
  const hasDataRef = useRef(data !== null);
  hasDataRef.current = data !== null;
  const load = useCallback(async () => {
    setIsLoading(!hasDataRef.current);
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

  const canManage = data?.canManage === true;

  // One participant preference for this popup and the Share screen's 공유 상태 (they show the same people).
  const { viewMode, changeViewMode } = useViewModePreference('participantViewMode');

  // The Grid's tiles: the same people as the List rows below, identity only.
  const memberTiles: readonly ParticipantTileData[] = (data?.participants ?? []).map(participant => ({
    key: participant.jupleId,
    jupleId: participant.jupleId,
    displayName: participant.displayName,
    imageUrl: participant.profileImageUrl,
    imageVersion: participant.profileImageVersion,
    isOwner: participant.role === 'owner',
    name: participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant),
    detail: t(participantRoleLabelKey(participant.role)),
    onAvatarPress: () => openProfile({ jupleId: participant.jupleId, displayName: participant.displayName, profileImageUrl: participant.profileImageUrl, profileImageVersion: participant.profileImageVersion, isSelf: participant.isMe }),
    avatarAccessibilityLabel: `${personLabel(participant)}, ${t('friends.personTitle')}`,
    onMore: participant.isMe ? undefined : () => setMenuPerson({ jupleId: participant.jupleId, name: personLabel(participant) }),
    moreAccessibilityLabel: moreLabel(personLabel(participant)),
    accessibilityLabel: `${participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant)}, ${t(participantRoleLabelKey(participant.role))}`,
    testID: `participants-sheet-${participant.jupleId}`,
  }));
  const pendingTiles: readonly ParticipantTileData[] = canManage
    ? (data?.pendingInvitations ?? []).map(invitation => ({
        key: `invitation-${invitation.invitationId}`,
        jupleId: invitation.jupleId,
        displayName: invitation.displayName,
        imageUrl: invitation.profileImageUrl,
        imageVersion: invitation.profileImageVersion,
        name: personLabel(invitation),
        detail: t(participantRoleLabelKey(invitationRoleOf(invitation.role))),
        onAvatarPress: () => openProfile({ jupleId: invitation.jupleId, displayName: invitation.displayName, profileImageUrl: invitation.profileImageUrl, profileImageVersion: invitation.profileImageVersion }),
        avatarAccessibilityLabel: `${personLabel(invitation)}, ${t('friends.personTitle')}`,
        accessibilityLabel: `${personLabel(invitation)}, ${t('collaboration.pendingCollaborationTitle')}`,
        testID: `participants-sheet-pending-${invitation.invitationId}`,
      }))
    : [];

  return (
    <BottomSheetModal
      // 참여자 ........ [List/Grid]: one line, the switch at the far end - the sheet's header, so dragging it down closes the sheet.
      headerActions={
        <View style={styles.headerActions}>
          <ViewModeToggle onChange={changeViewMode} value={viewMode} />
          <CloseButton onPress={onClose} testID="participants-sheet-close" />
        </View>
      }
      headerRowStyle={styles.titleRow}
      headerTitle={<Text style={styles.title}>{t('collections.participantsTitle')}</Text>}
      modalExtras={
        <>
          {profileModal}
          <ActionMenuDialog
            actions={[{
              label: t('safety.blockUserAction'),
              destructive: true,
              icon: BlockIcon,
              onPress: () => {
                const person = menuPerson;
                afterMenuCloses(() => setMenuPerson(null), () => { if (person) { requestBlock(person); } });
              },
            }]}
            cancelLabel={t('common.cancel')}
            onCancel={() => setMenuPerson(null)}
            onDismiss={onMenuDismiss}
            title={menuPerson?.name}
            visible={menuPerson !== null}
          />
          {blockDialogs}
        </>
      }
      onClose={onClose}
      testID="participants-sheet"
      visible={visible}
    >
          <ScrollView style={styles.list}>
            {isLoading && !data ? <ActivityIndicator style={styles.loading} /> : null}
            {viewMode === 'grid' && data ? (
              <>
                <ParticipantGrid testID="participants-sheet-grid" tiles={memberTiles} />
                {pendingTiles.length > 0 ? (
                  <>
                    <Text style={styles.sectionTitle}>{t('collaboration.pendingCollaborationTitle')}</Text>
                    <ParticipantGrid testID="participants-sheet-pending-grid" tiles={pendingTiles} />
                  </>
                ) : null}
              </>
            ) : null}
            {viewMode === 'list' ? data?.participants.map(participant => (
              // The WHOLE row opens the person - no need to hit the small avatar.
              <Pressable
                accessibilityLabel={`${personLabel(participant)}, ${t('friends.personTitle')}`}
                accessibilityRole="button"
                key={participant.jupleId}
                onPress={() => openProfile({ jupleId: participant.jupleId, displayName: participant.displayName, profileImageUrl: participant.profileImageUrl, profileImageVersion: participant.profileImageVersion, isSelf: participant.isMe })}
                style={styles.row}
                testID={`participants-sheet-${participant.jupleId}`}
              >
                <View testID={`participants-sheet-avatar-${participant.jupleId}`}>
                  <UserAvatar
                    displayName={participant.displayName}
                    imageUrl={participant.profileImageUrl}
                    imageVersion={participant.profileImageVersion}
                    jupleId={participant.jupleId}
                    size={32}
                  />
                  {participant.role === 'owner' ? <OwnerCrown avatarSize={32} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[styles.name, styles.nameText]}>
                    {participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant)}
                  </Text>
                  <Text style={styles.role}>{t(participantRoleLabelKey(participant.role))}</Text>
                  <Text numberOfLines={1} style={[styles.jupleId, ltrTextStyle]} testID={`participants-sheet-id-${participant.jupleId}`}>
                    {formatJupleId(participant.jupleId)}
                  </Text>
                </View>
                {participant.isMe ? null : (
                  <Pressable
                    accessibilityLabel={moreLabel(personLabel(participant))}
                    accessibilityRole="button"
                    onPress={() => setMenuPerson({ jupleId: participant.jupleId, name: personLabel(participant) })}
                    style={styles.more}
                    testID={`participants-sheet-more-${participant.jupleId}`}
                  >
                    <MoreIcon color={colors.textSecondary} size={20} />
                  </Pressable>
                )}
              </Pressable>
            )) : null}
            {viewMode === 'list' && canManage && data && data.pendingInvitations.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('collaboration.pendingCollaborationTitle')}</Text>
                {data.pendingInvitations.map(invitation => (
                  <Pressable
                    accessibilityLabel={`${personLabel(invitation)}, ${t('friends.personTitle')}`}
                    accessibilityRole="button"
                    key={invitation.invitationId}
                    onPress={() => openProfile({ jupleId: invitation.jupleId, displayName: invitation.displayName, profileImageUrl: invitation.profileImageUrl, profileImageVersion: invitation.profileImageVersion })}
                    style={styles.row}
                    testID={`participants-sheet-pending-${invitation.invitationId}`}
                  >
                    <View testID={`participants-sheet-pending-avatar-${invitation.invitationId}`}>
                      <UserAvatar
                        displayName={invitation.displayName}
                        imageUrl={invitation.profileImageUrl}
                        imageVersion={invitation.profileImageVersion}
                        jupleId={invitation.jupleId}
                        size={32}
                      />
                    </View>
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.name}>{personLabel(invitation)}</Text>
                      <Text style={styles.role}>{t(participantRoleLabelKey(invitationRoleOf(invitation.role)))}</Text>
                    </View>
                  </Pressable>
                ))}
              </>
            ) : null}
          </ScrollView>
          {/* Nothing to show yet: the centered failure state. Already showing people: they stay, with a compact retry row. */}
          {error && !data ? <ImportantState compact onRetry={load} testID="participants-sheet-error" /> : error ? <RefreshFailureNotice onRetry={load} testID="participants-sheet-refresh-failure" /> : null}
    </BottomSheetModal>
  );
}

export { OwnerCrown };

const styles = themedStyles(() => ({
  nameText: { flexShrink: 1 },
  more: { alignItems: 'center', flexShrink: 0, justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  titleRow: { marginBottom: spacing.sm },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
  list: { flexGrow: 0 },
  loading: { minHeight: 160, paddingVertical: spacing.lg },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  role: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  jupleId: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  headerActions: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
}));
