import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { UserAvatar } from '../components/UserAvatar';
import { OwnerCrown } from './OwnerCrown';
import { ParticipantGrid, type ParticipantTileData } from './ParticipantGrid';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference } from '../settings/viewModePreference';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import {
  formatJupleId,
  getCollectionParticipants,
  invitationRoleOf,
  participantRoleLabelKey,
  personLabel,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
} from './api/collaborationApi';
import { isCollectionLockedError } from './useCollectionItems';

/** How long the backdrop fade / sheet slide takes - an animation duration, not a wait before showing anything. */
const ENTRANCE_MS = 200;

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
  initialData = null,
}: CollectionParticipantsSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<CollectionParticipants | null>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ jupleId: string } | null>(null);

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

  // ONE controlled entrance, driven by a single value (0 = not shown, 1 = shown): the dim backdrop
  // fades in and the sheet slides up from just below its own final position - and until the sheet
  // has been laid out once (its real height known) it is fully transparent, so no first frame ever
  // shows an unanimated white panel, a default-sized one, or one that is still resizing. The
  // animation starts from that first layout, not from a timer, and never again while the sheet
  // stays open (the list growing later changes nothing about it).
  const { height: windowHeight } = useWindowDimensions();
  const entrance = useRef(new Animated.Value(0)).current;
  const entranceStartedRef = useRef(false);
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!visible) {
      entrance.setValue(0);
      entranceStartedRef.current = false;
      setSheetHeight(null);
    }
  }, [entrance, visible]);
  const handleSheetLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0 && !entranceStartedRef.current) {
      entranceStartedRef.current = true;
      setSheetHeight(height);
      Animated.timing(entrance, { duration: ENTRANCE_MS, toValue: 1, useNativeDriver: true }).start();
    }
  };
  // One participant preference for this popup and the Share screen's 공유 상태 (they show the same people).
  const { viewMode, changeViewMode } = useViewModePreference('participantViewMode');

  // The Grid's tiles: the same people and the same actions as the List rows below - a manageable
  // member's tile asks to remove them, a pending invitation's tile cancels it.
  const memberTiles: readonly ParticipantTileData[] = (data?.participants ?? []).map(participant => ({
    key: participant.jupleId,
    jupleId: participant.jupleId,
    displayName: participant.displayName,
    imageUrl: participant.profileImageUrl,
    imageVersion: participant.profileImageVersion,
    isOwner: participant.role === 'owner',
    name: participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant),
    detail: t(participantRoleLabelKey(participant.role)),
    onPress: canManage && participant.role !== 'owner' ? () => setPendingRemoval({ jupleId: participant.jupleId }) : undefined,
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
        onPress: busyKey === null
          ? () => runUnlocked(() => runAction(`revoke-${invitation.invitationId}`, () => revokeCollectionInvitation(authenticatedRequest, collectionId, invitation.invitationId)))
          : undefined,
        accessibilityLabel: `${personLabel(invitation)}, ${t('collaboration.pendingCollaborationTitle')}, ${t('collaboration.revoke')}`,
        testID: `participants-sheet-pending-${invitation.invitationId}`,
      }))
    : [];

  return (
    // The native Modal does not animate ("none") - the one entrance is the controlled one above, so the
    // two never stack. The backdrop and the whole window are translucent like every other modal here.
    <Modal animationType="none" navigationBarTranslucent onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.overlay}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: entrance }]} testID="participants-sheet-backdrop" />
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          accessibilityViewIsModal
          onLayout={handleSheetLayout}
          style={[
            styles.sheet,
            { paddingBottom: spacing.lg + insets.bottom },
            { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight ?? windowHeight, 0] }) }] },
          ]}
          testID="participants-sheet"
        >
          {/* 참여자 ........ [List/Grid]: one line, the switch at the far end. */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('collections.participantsTitle')}</Text>
            <ViewModeToggle onChange={changeViewMode} value={viewMode} />
          </View>
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
              <View key={participant.jupleId} style={styles.row} testID={`participants-sheet-${participant.jupleId}`}>
                <UserAvatar
                  displayName={participant.displayName}
                  imageUrl={participant.profileImageUrl}
                  imageVersion={participant.profileImageVersion}
                  jupleId={participant.jupleId}
                  size={32}
                />
                <View style={styles.rowText}>
                  <View style={styles.nameRow}>
                    {participant.role === 'owner' ? <OwnerCrown /> : null}
                    <Text numberOfLines={1} style={[styles.name, styles.nameText]}>
                      {participant.isMe ? t('collections.participantMe', { name: personLabel(participant) }) : personLabel(participant)}
                    </Text>
                  </View>
                  <Text style={styles.role}>{t(participantRoleLabelKey(participant.role))}</Text>
                  <Text numberOfLines={1} style={[styles.jupleId, ltrTextStyle]} testID={`participants-sheet-id-${participant.jupleId}`}>
                    {formatJupleId(participant.jupleId)}
                  </Text>
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
            )) : null}
            {viewMode === 'list' && canManage && data && data.pendingInvitations.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>{t('collaboration.pendingCollaborationTitle')}</Text>
                {data.pendingInvitations.map(invitation => (
                  <View key={invitation.invitationId} style={styles.row} testID={`participants-sheet-pending-${invitation.invitationId}`}>
                    <UserAvatar
                      displayName={invitation.displayName}
                      imageUrl={invitation.profileImageUrl}
                      imageVersion={invitation.profileImageVersion}
                      jupleId={invitation.jupleId}
                      size={32}
                    />
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
        </Animated.View>
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

export { OwnerCrown };

const styles = StyleSheet.create({
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  nameText: { flexShrink: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' },
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
  titleRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
  list: { flexGrow: 0 },
  loading: { minHeight: 160, paddingVertical: spacing.lg },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  role: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  jupleId: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.md },
  action: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.sm },
  actionLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  removeLabel: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  close: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.sm, minHeight: minTouchTarget, justifyContent: 'center' },
  closeLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
});
