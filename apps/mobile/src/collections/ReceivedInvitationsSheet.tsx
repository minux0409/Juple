import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { useAppToast } from '../components/AppToast';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import {
  acceptCollectionInvitation,
  declineCollectionInvitation,
  invitationRoleOf,
  personLabel,
  type ReceivedCollectionInvitation,
} from './api/collaborationApi';
import { CategoryIconTile } from './CategoryIconTile';

function getResponseErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict' || error.kind === 'notFound') {
      // Expired, revoked, already answered, or the Category is gone - nothing to act on anymore.
      return t('collaboration.invitationNoLongerValid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collaboration.invitationResponseFallback');
}

interface ReceivedInvitationsSheetProps {
  readonly visible: boolean;
  readonly invitations: readonly ReceivedCollectionInvitation[];
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly onClose: () => void;
  /** The invitation was answered - the caller drops it (and, when accepted, refreshes its lists). */
  readonly onResponded: (invitationId: number, accepted: boolean) => void;
  /** The list is out of date (e.g. the invitation expired meanwhile) - the caller reloads it. */
  readonly onStale: () => void;
}

/**
 * 공유 요청 (opened from Categories > 공유 카테고리): collaboration invitations other Owners sent to
 * the signed-in user. Accepting makes them a Contributor - the Category then appears under 공유
 * 카테고리; only the invited account can see or answer these. Invitations this user SENT are a
 * different thing, managed on each Category's Share screen.
 */
export function ReceivedInvitationsSheet({
  visible,
  invitations,
  authenticatedRequest,
  onClose,
  onResponded,
  onStale,
}: ReceivedInvitationsSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { showNotificationToast } = useAppToast();
  const [busyInvitationId, setBusyInvitationId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const respond = async (invitation: ReceivedCollectionInvitation, accept: boolean) => {
    if (busyInvitationId !== null) {
      return;
    }
    setBusyInvitationId(invitation.invitationId);
    setError(null);
    try {
      if (accept) {
        await acceptCollectionInvitation(authenticatedRequest, invitation.invitationId);
        showNotificationToast(t('collaboration.invitationAccepted'));
      } else {
        await declineCollectionInvitation(authenticatedRequest, invitation.invitationId);
      }
      onResponded(invitation.invitationId, accept);
    } catch (caughtError) {
      setError(getResponseErrorMessage(caughtError, t));
      onStale();
    } finally {
      setBusyInvitationId(null);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: spacing.lg + insets.bottom }]} testID="share-requests-sheet">
          <Text style={styles.title}>{t('collections.shareRequests')}</Text>
          <ScrollView style={styles.list}>
            {invitations.length === 0 ? <Text style={styles.empty}>{t('collaboration.invitationsEmpty')}</Text> : null}
            {invitations.map(invitation => {
              const isBusy = busyInvitationId === invitation.invitationId;
              return (
                <View key={invitation.invitationId} style={styles.card} testID={`share-request-${invitation.invitationId}`}>
                  <View style={styles.header}>
                    <CategoryIconTile collectionId={invitation.collectionId} color={invitation.color} icon={invitation.icon} size={44} />
                    <View style={styles.headerText}>
                      <Text numberOfLines={2} style={styles.name}>{invitation.collectionName}</Text>
                      <Text numberOfLines={1} style={styles.meta}>
                        {t('collections.sharedByOwner', {
                          jupleId: personLabel({ jupleId: invitation.ownerJupleId, displayName: invitation.ownerDisplayName }),
                        })}
                      </Text>
                      {/* What accepting gives: 읽기 전용, or 읽기·쓰기 (view + add own links). */}
                      <Text numberOfLines={2} style={styles.meta} testID={`share-request-role-${invitation.invitationId}`}>
                        {invitationRoleOf(invitation.role) === 'viewer' ? t('collaboration.roleViewer') : t('collaboration.roleContributor')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={busyInvitationId !== null}
                      onPress={() => respond(invitation, false)}
                      style={styles.declineButton}
                      testID={`share-request-decline-${invitation.invitationId}`}
                    >
                      <Text style={styles.declineLabel}>{t('collaboration.decline')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ busy: isBusy }}
                      disabled={busyInvitationId !== null}
                      onPress={() => respond(invitation, true)}
                      style={styles.acceptButton}
                      testID={`share-request-accept-${invitation.invitationId}`}
                    >
                      {isBusy ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.acceptLabel}>{t('collaboration.accept')}</Text>}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeLabel}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '80%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '100%',
  },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  list: { flexGrow: 0 },
  empty: { color: colors.textSecondary, fontSize: 14, paddingVertical: spacing.lg, textAlign: 'center' },
  card: { backgroundColor: colors.background, borderRadius: radii.lg, marginTop: spacing.sm, padding: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerText: { flex: 1, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  declineButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  declineLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  acceptButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  acceptLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  close: { alignItems: 'center', borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.sm, minHeight: minTouchTarget, justifyContent: 'center' },
  closeLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
});
