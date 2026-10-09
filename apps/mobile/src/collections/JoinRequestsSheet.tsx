import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportantState } from '../components/ImportantState';
import { UserAvatar } from '../components/UserAvatar';
import { useMessageDialog } from '../components/useMessageDialog';
import { formatCommentTime } from '../comments/formatCommentTime';
import { CloseIcon } from '../icons/CloseIcon';
import { subscribeSocialPushEvents } from '../push/pushEvents';
import { colors, ltrTextStyle, minTouchTarget, spacing } from '../theme/tokens';
import { formatJupleId, personLabel } from './api/collaborationApi';
import {
  approveCollectionJoinRequest,
  listCollectionJoinRequests,
  rejectCollectionJoinRequest,
  type CollectionJoinRequest,
} from './api/collectionsApi';
import { PendingActionCardShell, PendingSubmissionCardSkeleton } from './PendingSubmissionCard';
import { contentGateOfError } from './useCollectionItems';

const AVATAR_SIZE = 44;
const STRIP_ACTION_HEIGHT = 46;
const MAX_SKELETON_CARDS = 3;

interface JoinRequestsSheetProps {
  readonly visible: boolean;
  readonly collectionId: number;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly onClose: () => void;
  /** The count the opener already shows - only decides how many skeleton cards the first frame holds. */
  readonly expectedCount?: number;
  /** After an approval or rejection (or a request that turned out to be gone): the caller refreshes its counts and badge. */
  readonly onChanged?: () => void;
}

/**
 * 참여 요청: the Owner's applicants - people who asked to join this Collection through its PRIVATE link (a CollectionJoinRequest, user -> Owner) -
 * in the SAME bottom sheet system as 받은 승인 요청 (BottomSheetModal shell with the title and the X in one header row, the shared card frame and
 * equal-zone action strip, the common confirmation and message dialogs), opened over the Collection instead of a screen of its own. Each card is
 * one applicant: avatar, name, Juple ID (under a chosen name) and when they asked, with [거절] [승인] below. 승인 makes them a Viewer, 거절 makes
 * nothing; both ask first. Not 받은 초대 요청 (an invitation goes the other way) and not the participants (they are not members yet). When the
 * last applicant is answered the sheet closes, like the Owner's approval queue.
 */
export function JoinRequestsSheet({ visible, collectionId, authenticatedRequest, onClose, expectedCount = 0, onChanged }: JoinRequestsSheetProps) {
  const { t } = useTranslation();
  const { showMessage, messageDialog } = useMessageDialog();
  const [rows, setRows] = useState<readonly CollectionJoinRequest[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [busyKind, setBusyKind] = useState<'approve' | 'reject' | null>(null);
  const [pending, setPending] = useState<{ readonly row: CollectionJoinRequest; readonly approve: boolean } | null>(null);
  // A newer load supersedes an older one still in flight.
  const loadIdRef = useRef(0);
  // Synchronous single-flight guard (state alone is stale within one frame): one answer at a time.
  const answeringRef = useRef(false);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    setLoadMessage(null);
    setIsError(false);
    try {
      const loaded = await listCollectionJoinRequests(authenticatedRequest, collectionId);
      if (loadId !== loadIdRef.current) {
        return;
      }
      setRows(loaded);
      setHasLoaded(true);
    } catch (caughtError) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      setHasLoaded(true);
      setIsError(true);
      setLoadMessage(contentGateOfError(caughtError) === 'lock' ? t('collections.lockedMessage') : null);
    }
  }, [authenticatedRequest, collectionId, t]);

  // Another Collection never shows this one's applicants.
  useEffect(() => {
    setRows([]);
    setHasLoaded(false);
  }, [collectionId]);

  useEffect(() => {
    if (visible) {
      load().catch(() => undefined);
    }
  }, [load, visible]);

  // A new applicant (or one answered on another device) arrives as a Push refresh signal for this Collection: re-read silently, no polling.
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    return subscribeSocialPushEvents(event => {
      if ((event.type === 'joinRequest' || event.type === 'collectionContentChanged') && (event.collectionId === null || event.collectionId === collectionId)) {
        load().catch(() => undefined);
      }
    });
  }, [collectionId, load, visible]);

  /** A card leaves; the last one closes the sheet (nothing left to answer), like the approval queue. */
  const removeRow = (requestId: number) => {
    const remaining = rows.filter(entry => entry.requestId !== requestId);
    setRows(remaining);
    onChanged?.();
    if (remaining.length === 0) {
      onClose();
    }
  };

  const answer = async (row: CollectionJoinRequest, approve: boolean) => {
    if (busyId !== null || answeringRef.current) {
      return;
    }
    answeringRef.current = true;
    setBusyId(row.requestId);
    setBusyKind(approve ? 'approve' : 'reject');
    try {
      if (approve) {
        await approveCollectionJoinRequest(authenticatedRequest, collectionId, row.requestId);
      } else {
        await rejectCollectionJoinRequest(authenticatedRequest, collectionId, row.requestId);
      }
      removeRow(row.requestId);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && (caughtError.kind === 'notFound' || (caughtError.kind === 'conflict' && caughtError.code === 'joinNotAllowed'))) {
        // Answered elsewhere, turned obsolete, or the Collection went public: it simply is not waiting any more.
        showMessage(t('shareSheet.joinRequestNotActionable'));
        removeRow(row.requestId);
      } else {
        // The card stays; the sheet stays open.
        showMessage(t('submissions.actionError'));
      }
    } finally {
      answeringRef.current = false;
      setBusyId(null);
      setBusyKind(null);
    }
  };

  const renderStrip = (row: CollectionJoinRequest) => {
    const person = { jupleId: row.jupleId, displayName: row.displayName };
    const isBusy = busyId === row.requestId;
    const anyBusy = busyId !== null;
    const rejecting = isBusy && busyKind === 'reject';
    const approving = isBusy && busyKind === 'approve';
    return (
      <View style={styles.strip}>
        <Pressable
          accessibilityLabel={t('shareSheet.joinRequestRejectA11y', { name: personLabel(person) })}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: rejecting }}
          disabled={anyBusy}
          onPress={() => setPending({ row, approve: false })}
          style={[styles.stripAction, anyBusy && !rejecting && styles.disabled]}
          testID={`join-request-reject-${row.requestId}`}
        >
          {rejecting
            ? <ActivityIndicator color={colors.danger} size="small" />
            : <Text numberOfLines={1} style={[styles.stripLabel, styles.reject]}>{t('shareSheet.joinRequestReject')}</Text>}
        </Pressable>
        <Pressable
          accessibilityLabel={t('shareSheet.joinRequestApproveA11y', { name: personLabel(person) })}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: approving }}
          disabled={anyBusy}
          onPress={() => setPending({ row, approve: true })}
          style={[styles.stripAction, anyBusy && !approving && styles.disabled]}
          testID={`join-request-approve-${row.requestId}`}
        >
          {approving
            ? <ActivityIndicator color={colors.brand} size="small" />
            : <Text numberOfLines={1} style={[styles.stripLabel, styles.approve]}>{t('shareSheet.joinRequestApprove')}</Text>}
        </Pressable>
      </View>
    );
  };

  const showSkeleton = !hasLoaded && rows.length === 0;
  const skeletonCount = Math.min(Math.max(expectedCount, 1), MAX_SKELETON_CARDS);

  return (
    <BottomSheetModal
      headerActions={
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onClose}
          style={styles.closeButton}
          testID="join-requests-sheet-close"
        >
          <CloseIcon color={colors.textSecondary} size={20} />
        </Pressable>
      }
      headerRowStyle={styles.titleRow}
      headerTitle={<Text accessibilityRole="header" style={styles.title} testID="join-requests-title">{t('shareSheet.joinRequestsTitle')}</Text>}
      modalExtras={
        <>
          <ConfirmDialog
            cancelLabel={t('common.cancel')}
            confirmLabel={pending?.approve ? t('shareSheet.joinRequestApprove') : t('shareSheet.joinRequestReject')}
            destructive={pending ? !pending.approve : false}
            message={pending ? t(pending.approve ? 'shareSheet.joinRequestApproveMessage' : 'shareSheet.joinRequestRejectMessage', { name: personLabel({ jupleId: pending.row.jupleId, displayName: pending.row.displayName }) }) : ''}
            onCancel={() => setPending(null)}
            onConfirm={() => {
              const chosen = pending;
              setPending(null);
              if (chosen) {
                answer(chosen.row, chosen.approve).catch(() => undefined);
              }
            }}
            title={pending?.approve ? t('shareSheet.joinRequestApproveTitle') : t('shareSheet.joinRequestRejectTitle')}
            visible={pending !== null}
          />
          {/* An answer that failed or is no longer possible: the common centered message, the sheet stays. */}
          {messageDialog}
        </>
      }
      onClose={onClose}
      testID="join-requests-sheet"
      visible={visible}
    >
      {showSkeleton ? (
        <View style={styles.list} testID="join-requests-skeleton">
          {Array.from({ length: skeletonCount }, (_, index) => (
            <View key={index} style={index > 0 ? styles.gap : undefined}>
              <PendingSubmissionCardSkeleton />
            </View>
          ))}
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={rows}
          ItemSeparatorComponent={Separator}
          keyExtractor={row => String(row.requestId)}
          ListEmptyComponent={
            isError ? (
              <ImportantState compact message={loadMessage ?? undefined} onRetry={() => { load().catch(() => undefined); }} testID="join-requests-empty" variant={loadMessage ? 'notice' : 'loadFailed'} />
            ) : (
              <Text style={styles.empty} testID="join-requests-empty">{t('shareSheet.requestsEmpty')}</Text>
            )
          }
          renderItem={({ item }) => <ApplicantCard actionStrip={renderStrip(item)} row={item} />}
          style={styles.list}
          testID="join-requests-list"
        />
      )}
    </BottomSheetModal>
  );
}

function ApplicantCard({ row, actionStrip }: { readonly row: CollectionJoinRequest; readonly actionStrip: ReactNode }) {
  const { t } = useTranslation();
  const person = { jupleId: row.jupleId, displayName: row.displayName };
  return (
    <PendingActionCardShell actionStrip={actionStrip} testID={`join-request-${row.requestId}`}>
      <View style={styles.info}>
        <View testID={`join-request-avatar-${row.requestId}`}>
          <UserAvatar displayName={row.displayName} imageUrl={row.profileImageUrl} imageVersion={row.profileImageVersion} jupleId={row.jupleId} size={AVATAR_SIZE} />
        </View>
        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.name}>{personLabel(person)}</Text>
          {row.displayName ? <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{formatJupleId(row.jupleId)}</Text> : null}
          <Text numberOfLines={1} style={styles.meta}>{formatCommentTime(row.requestedAtUtc, t)}</Text>
        </View>
      </View>
    </PendingActionCardShell>
  );
}

function Separator() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  titleRow: { marginBottom: spacing.xs },
  title: { color: colors.textPrimary, flex: 1, fontSize: 17, fontWeight: '700' },
  closeButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', marginEnd: -spacing.sm, width: minTouchTarget },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.xs },
  gap: { height: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 15, paddingVertical: spacing.xl, textAlign: 'center' },
  info: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm + 2, minWidth: 0 },
  text: { flex: 1, gap: 2, minWidth: 0 },
  name: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  // Equal zones across the card, each a full-width 46dp target (>= 44dp): 거절 then 승인.
  strip: { flexDirection: 'row' },
  stripAction: { alignItems: 'center', flex: 1, height: STRIP_ACTION_HEIGHT, justifyContent: 'center' },
  stripLabel: { fontSize: 15, fontWeight: '700' },
  reject: { color: colors.danger },
  approve: { color: colors.brand },
  disabled: { opacity: 0.5 },
});
