import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { useAppToast } from '../components/AppToast';
import { BottomSheetModal } from '../components/BottomSheetModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ImportantState } from '../components/ImportantState';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { CheckIcon } from '../icons/CheckIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { markCollectionSubmissionRequestsRead } from '../notifications/notificationsApi';
import { setUnreadCount } from '../notifications/notificationState';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { subscribeSocialPushEvents, type SocialPushEventType } from '../push/pushEvents';
import {
  approveCollectionSubmission,
  cancelMySubmission,
  getCollectionSubmissions,
  getMyCollectionSubmissions,
  getMyPendingSubmissionsAcrossCollections,
  rejectCollectionSubmission,
} from './api/collectionsApi';
import { PendingSubmissionCard, PendingSubmissionCardSkeleton, type PendingSubmissionRow } from './PendingSubmissionCard';
import { useCancelSubmission } from './useCancelSubmission';
import { contentGateOfError } from './useCollectionItems';

/** What changes a waiting queue from outside while its popup is open (Push refresh signals - no polling). */
const OWNER_REFRESH_EVENTS: readonly SocialPushEventType[] = ['collectionContentChanged', 'collectionLinkSubmission'];
const MINE_REFRESH_EVENTS: readonly SocialPushEventType[] = ['collectionLinkSubmissionApproved', 'collectionLinkSubmissionRejected', 'collectionContentChanged'];

const ACTION_ICON_SIZE = 22;
const STRIP_ACTION_HEIGHT = 46;

/** Skeleton cards while the first page loads - never more than the sheet would show anyway. */
const MAX_SKELETON_CARDS = 3;

interface ApprovalSubmissionSheetProps {
  readonly visible: boolean;
  /**
   * 'owner': the Owner's 링크 승인 대기 queue of ONE Collection (collectionId required), with 거절 / 승인.
   * 'mine': my own 내 링크 승인 대기 - view only; collectionId = that one Collection, null = all the
   * Collections I am a member of (each card then says which one it waits in).
   */
  readonly variant: 'owner' | 'mine';
  readonly collectionId: number | null;
  readonly authenticatedRequest: AuthenticatedApiRequest;
  readonly onClose: () => void;
  /** The count the opener already shows - only decides how many skeleton cards the first frame holds. */
  readonly expectedCount?: number;
  /**
   * Owner variant: called after an approval or rejection; mine variant: after one of MY proposals was
   * cancelled - so the caller refreshes its counts (and content).
   */
  readonly onChanged?: () => void;
  /** Mine variant: the caller's total number of waiting links as the server just reported it. */
  readonly onTotalLoaded?: (total: number) => void;
}

/**
 * The one 승인 대기 popup (bottom sheet, content-driven, at most 75% tall, scrolling inside): the Owner's
 * queue of a Collection and a submitter's own waiting links - a Collection's or all of them - share the
 * card, the paging and the geometry; the variant only decides the data source and the actions. Opened
 * from a long status row instead of a full screen, because these are status/task lists, not places.
 * The first frame is already the final geometry (skeleton cards, or the rows already held), and the
 * entrance never starts before the sheet has been laid out (see BottomSheetModal).
 */
export function ApprovalSubmissionSheet({
  visible,
  variant,
  collectionId,
  authenticatedRequest,
  onClose,
  expectedCount = 0,
  onChanged,
  onTotalLoaded,
}: ApprovalSubmissionSheetProps) {
  const { t } = useTranslation();
  const { showNotificationToast } = useAppToast();
  const [rows, setRows] = useState<readonly PendingSubmissionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Which of the two owner actions is running on the busy row - its icon is the one showing the spinner.
  const [busyKind, setBusyKind] = useState<'approve' | 'reject' | null>(null);
  const [pendingReject, setPendingReject] = useState<PendingSubmissionRow | null>(null);
  const [pendingApprove, setPendingApprove] = useState<PendingSubmissionRow | null>(null);
  const isLoadingMoreRef = useRef(false);
  // A newer load supersedes an older one still in flight.
  const loadIdRef = useRef(0);
  const onTotalLoadedRef = useRef(onTotalLoaded);
  onTotalLoadedRef.current = onTotalLoaded;
  const isOwner = variant === 'owner';

  const fetchPage = useCallback(
    async (cursor: number | null): Promise<{ rows: readonly PendingSubmissionRow[]; nextCursor: number | null; total: number | null }> => {
      if (isOwner) {
        const page = await getCollectionSubmissions(authenticatedRequest, collectionId as number, cursor);
        return { rows: page.items, nextCursor: page.nextCursor, total: null };
      }
      if (collectionId === null) {
        const page = await getMyPendingSubmissionsAcrossCollections(authenticatedRequest, cursor);
        return { rows: page.items, nextCursor: page.nextCursor, total: page.totalCount };
      }
      const page = await getMyCollectionSubmissions(authenticatedRequest, collectionId, cursor);
      return { rows: page.items, nextCursor: page.nextCursor, total: page.totalCount ?? null };
    },
    [authenticatedRequest, collectionId, isOwner],
  );

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    // With rows already on screen (a reopened sheet) the reload is silent: no skeleton, no layout change until it differs.
    setIsLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const page = await fetchPage(null);
      if (loadId !== loadIdRef.current) {
        return;
      }
      setRows(page.rows);
      setNextCursor(page.nextCursor);
      setHasLoaded(true);
      if (page.total !== null) {
        onTotalLoadedRef.current?.(page.total);
      }
      if (isOwner && collectionId !== null) {
        // Seeing the queue reads its 승인 요청 notifications (best-effort). The requests themselves - and
        // the Collection's pending count - stay until each one is approved or declined.
        markCollectionSubmissionRequestsRead(authenticatedRequest, collectionId)
          .then(result => setUnreadCount(result.unreadCount))
          .catch(() => undefined);
      }
    } catch (caughtError) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      setHasLoaded(true);
      setIsError(true);
      // Locked: a definite answer with its own sentence. Anything else: the app-wide load-failure text (message null).
      setMessage(contentGateOfError(caughtError) === 'lock' ? t('collections.lockedMessage') : null);
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [authenticatedRequest, collectionId, fetchPage, isOwner, t]);

  // A different scope (another Collection, or all) never shows the previous scope's rows.
  useEffect(() => {
    setRows([]);
    setNextCursor(null);
    setHasLoaded(false);
  }, [collectionId, variant]);

  useEffect(() => {
    if (visible) {
      load().catch(() => undefined);
    }
  }, [load, visible]);

  const loadMore = async () => {
    if (nextCursor === null || isLoadingMoreRef.current || isLoading) {
      return;
    }
    isLoadingMoreRef.current = true;
    try {
      const page = await fetchPage(nextCursor);
      setRows(previous => [...previous, ...page.rows.filter(entry => !previous.some(existing => existing.submissionId === entry.submissionId))]);
      setNextCursor(page.nextCursor);
    } catch {
      // The next scroll tries again.
    } finally {
      isLoadingMoreRef.current = false;
    }
  };

  // The open queue follows what happens elsewhere without polling: a requester cancelling (or another
  // device answering) arrives as a Push refresh signal for this Collection and re-reads the list silently.
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const events = isOwner ? OWNER_REFRESH_EVENTS : MINE_REFRESH_EVENTS;
    return subscribeSocialPushEvents(event => {
      if (events.includes(event.type) && (collectionId === null || event.collectionId === null || event.collectionId === collectionId)) {
        load().catch(() => undefined);
      }
    });
  }, [collectionId, isOwner, load, visible]);

  /**
   * A row leaves; when it was the last one the OWNER's queue has nothing left to say and closes. My own
   * list never closes by itself (an empty state shows instead - cancelling is not "done with the sheet").
   */
  const removeRow = (submissionId: number, closingNotice?: string) => {
    const remaining = rows.filter(entry => entry.submissionId !== submissionId);
    setRows(remaining);
    onChanged?.();
    if (isOwner && remaining.length === 0 && nextCursor === null) {
      onClose();
      if (closingNotice) {
        showNotificationToast(closingNotice);
      }
    }
  };

  // Synchronous single-flight guard (state alone is stale within one frame): one answer at a time.
  const answeringRef = useRef(false);

  const approve = async (row: PendingSubmissionRow) => {
    if (busyId !== null || collectionId === null || answeringRef.current) {
      return;
    }
    answeringRef.current = true;
    setBusyId(row.submissionId);
    setBusyKind('approve');
    setMessage(null);
    try {
      await approveCollectionSubmission(authenticatedRequest, collectionId, row.submissionId);
      setIsError(false);
      removeRow(row.submissionId, t('submissions.approved'));
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        // Cancelled by the requester, or approved / rejected elsewhere - it is simply not waiting any more.
        removeRow(row.submissionId, t('submissions.alreadyCancelledOrProcessed'));
        setIsError(true);
        setMessage(t('submissions.alreadyCancelledOrProcessed'));
      } else if (caughtError instanceof ApiError && caughtError.kind === 'conflict'
        && (caughtError.code === 'linkAlreadyInCollection' || caughtError.code === 'submissionUnavailable')) {
        // The server cleared it: the link is already there, or its proposer deleted it.
        removeRow(row.submissionId, caughtError.code === 'linkAlreadyInCollection' ? t('collections.linkAlreadyInCollection') : t('submissions.unavailable'));
        setIsError(true);
        setMessage(caughtError.code === 'linkAlreadyInCollection' ? t('collections.linkAlreadyInCollection') : t('submissions.unavailable'));
      } else {
        setIsError(true);
        setMessage(t('submissions.actionError'));
      }
    } finally {
      answeringRef.current = false;
      setBusyId(null);
      setBusyKind(null);
    }
  };

  const reject = async (row: PendingSubmissionRow) => {
    setPendingReject(null);
    if (collectionId === null || answeringRef.current) {
      return;
    }
    answeringRef.current = true;
    setBusyId(row.submissionId);
    setBusyKind('reject');
    setMessage(null);
    try {
      await rejectCollectionSubmission(authenticatedRequest, collectionId, row.submissionId);
      setIsError(false);
      removeRow(row.submissionId, t('submissions.rejected'));
    } catch {
      setIsError(true);
      setMessage(t('submissions.actionError'));
    } finally {
      answeringRef.current = false;
      setBusyId(null);
      setBusyKind(null);
    }
  };

  // My own pending proposals: 요청 취소 (confirmed, row-level busy, the row leaves on success). A proposal that
  // was already answered is gone from the list too, with its own message.
  const cancellation = useCancelSubmission({
    cancel: row => cancelMySubmission(authenticatedRequest, row.submissionId),
    onGone: row => removeRow(row.submissionId),
  });

  /**
   * The Owner's action strip - three EQUAL zones across the card, icon-only: [open the submitted link] [reject X]
   * [approve check]. Reject and approve sit a full zone apart (no accidental neighbor taps), and BOTH ask for a
   * confirmation first - the common dialog - so a stray tap never answers a request. Opening the link only opens it.
   * While an answer runs every icon is disabled (single flight) and the running one shows the spinner. The labels
   * stay fully localized.
   */
  const renderOwnerStrip = (row: PendingSubmissionRow) => {
    const title = row.title?.trim() ? row.title : row.url;
    const isBusy = busyId === row.submissionId;
    const anyBusy = busyId !== null;
    const rejecting = isBusy && busyKind === 'reject';
    const approving = isBusy && busyKind === 'approve';
    return (
      <View style={styles.strip}>
        <Pressable
          accessibilityLabel={`${t('trash.openLink')}: ${title}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy }}
          disabled={anyBusy}
          onPress={() => {
            // Only opens the submitted URL - never answers the request.
            cancellation.openLink({ submissionId: row.submissionId, title: row.title, url: row.url }).catch(() => undefined);
          }}
          style={[styles.stripAction, anyBusy && styles.disabled]}
          testID={`submission-open-${row.submissionId}`}
        >
          <ExternalLinkIcon color={colors.textSecondary} size={ACTION_ICON_SIZE} />
        </Pressable>
        <Pressable
          accessibilityLabel={t('submissions.rejectA11y', { title })}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: rejecting }}
          disabled={anyBusy}
          onPress={() => setPendingReject(row)}
          style={[styles.stripAction, anyBusy && !rejecting && styles.disabled]}
          testID={`submission-reject-${row.submissionId}`}
        >
          {rejecting
            ? <ActivityIndicator color={colors.danger} size="small" />
            : <CloseIcon color={colors.danger} size={ACTION_ICON_SIZE} strokeWidth={2.25} />}
        </Pressable>
        <Pressable
          accessibilityLabel={t('submissions.approveA11y', { title })}
          accessibilityRole="button"
          accessibilityState={{ disabled: anyBusy, busy: approving }}
          disabled={anyBusy}
          onPress={() => setPendingApprove(row)}
          style={[styles.stripAction, anyBusy && !approving && styles.disabled]}
          testID={`submission-approve-${row.submissionId}`}
        >
          {approving
            ? <ActivityIndicator color={colors.brand} size="small" />
            : <CheckIcon color={colors.brand} size={ACTION_ICON_SIZE} strokeWidth={2.5} />}
        </Pressable>
      </View>
    );
  };

  const showSkeleton = !hasLoaded && rows.length === 0;
  const skeletonCount = Math.min(Math.max(expectedCount, 1), MAX_SKELETON_CARDS);
  const emptyKey = isOwner ? 'submissions.empty' : 'submissions.myEmpty';

  return (
    <BottomSheetModal
      modalExtras={
        <>
          <ConfirmDialog
            cancelLabel={t('common.cancel')}
            confirmLabel={t('submissions.reject')}
            message={t('submissions.rejectConfirmMessage')}
            onCancel={() => setPendingReject(null)}
            onConfirm={() => {
              if (pendingReject) {
                reject(pendingReject).catch(() => undefined);
              }
            }}
            title={t('submissions.rejectConfirmTitle')}
            visible={pendingReject !== null}
          />
          <ConfirmDialog
            cancelLabel={t('common.cancel')}
            confirmLabel={t('submissions.approve')}
            destructive={false}
            message={t('submissions.approveConfirmMessage')}
            onCancel={() => setPendingApprove(null)}
            onConfirm={() => {
              const row = pendingApprove;
              setPendingApprove(null);
              if (row) {
                approve(row).catch(() => undefined);
              }
            }}
            title={t('submissions.approveConfirmTitle')}
            visible={pendingApprove !== null}
          />
          {/* The cancel confirmation (requester) and the common message dialog (a link that cannot be opened). */}
          {cancellation.dialogs}
        </>
      }
      // Title and the X in one row (no bottom 닫기 row) - the sheet's header, so dragging it down closes the sheet.
      headerActions={
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          hitSlop={4}
          onPress={onClose}
          style={styles.closeButton}
          testID="approval-sheet-close"
        >
          <CloseIcon color={colors.textSecondary} size={20} />
        </Pressable>
      }
      headerRowStyle={styles.titleRow}
      headerTitle={<Text accessibilityRole="header" style={styles.title}>{t(isOwner ? 'submissions.ownerSheetTitle' : 'submissions.mySheetTitle')}</Text>}
      onClose={onClose}
      testID={isOwner ? 'owner-approval-sheet' : 'my-approval-sheet'}
      visible={visible}
    >
      {showSkeleton ? (
        <View style={styles.list} testID="approval-sheet-skeleton">
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
          keyExtractor={row => String(row.submissionId)}
          ListEmptyComponent={
            isError ? (
              <ImportantState compact message={message ?? undefined} onRetry={() => { load().catch(() => undefined); }} testID="approval-sheet-empty" variant={message ? 'notice' : 'loadFailed'} />
            ) : (
              <Text style={styles.empty} testID="approval-sheet-empty">{message ?? t(emptyKey)}</Text>
            )
          }
          onEndReached={() => {
            loadMore().catch(() => undefined);
          }}
          onEndReachedThreshold={0.5}
          onScrollBeginDrag={closeOpenRow}
          renderItem={({ item }) => (
            isOwner ? (
              <PendingSubmissionCard actionStrip={renderOwnerStrip(item)} row={item} variant={variant} />
            ) : (
              // Mine: swipe left to cancel; the external-link icon is the card's only visible action.
              cancellation.swipeToCancel(
                { submissionId: item.submissionId, title: item.title, url: item.url },
                <PendingSubmissionCard
                  embedded
                  row={item}
                  trailing={cancellation.renderOpenAction({ submissionId: item.submissionId, title: item.title, url: item.url })}
                  variant={variant}
                />,
              )
            )
          )}
          style={styles.list}
          testID="approval-sheet-list"
        />
      )}
      {message && rows.length > 0 ? <Text style={styles.error} testID="approval-sheet-message">{message}</Text> : null}
    </BottomSheetModal>
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
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm, paddingVertical: spacing.xs, textAlign: 'center' },
  // Three equal zones across the card; each is a full-width, 46dp-high target (>= 44dp) with a whole third of the width.
  strip: { flexDirection: 'row' },
  stripAction: { alignItems: 'center', flex: 1, height: STRIP_ACTION_HEIGHT, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
