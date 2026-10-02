import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { personLabel } from '../collections/api/collaborationApi';
import {
  approveCollectionSubmission,
  getCollectionSubmissions,
  rejectCollectionSubmission,
  type CollectionLinkSubmission,
} from '../collections/api/collectionsApi';
import { contentGateOfError } from '../collections/useCollectionItems';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatSavedLinkTimestamp } from '../components/SavedLinkMetaRow';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { UserAvatar } from '../components/UserAvatar';
import { GlobeIcon } from '../icons/GlobeIcon';
import { UserIcon } from '../icons/UserIcon';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { markCollectionSubmissionRequestsRead } from '../notifications/notificationsApi';
import { setUnreadCount } from '../notifications/notificationState';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionSubmissions'>;

const THUMBNAIL_SIZE = 56;

/**
 * 링크 승인 대기 - the Owner's list of links proposed for one Collection (승인 후 추가), oldest
 * first. Each shows the link as it will appear (its automatic preview, title, site) and who proposed
 * it - a member by avatar and name; someone who proposed through the public link only as that, never
 * by name. 승인 makes it a link of the Collection; 거절 (after a short confirmation) drops it. Neither
 * reloads the whole list: the row simply leaves; the Collection screen refreshes on its own focus.
 */
export function CollectionSubmissionsScreen({ route }: Props) {
  const { collectionId } = route.params;
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const { showNotificationToast } = useAppToast();
  const [items, setItems] = useState<readonly CollectionLinkSubmission[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingReject, setPendingReject] = useState<CollectionLinkSubmission | null>(null);
  const isLoadingMoreRef = useRef(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const page = await getCollectionSubmissions(authenticatedRequest, collectionId);
      setItems(page.items);
      setNextCursor(page.nextCursor);
      // Seeing the list reads its 승인 요청 notifications (best-effort). The requests themselves - and
      // the Collection card's pending count - stay until each one is approved or declined.
      markCollectionSubmissionRequestsRead(authenticatedRequest, collectionId)
        .then(result => setUnreadCount(result.unreadCount))
        .catch(() => undefined);
    } catch (caughtError) {
      const gate = contentGateOfError(caughtError);
      setLoadError(gate === 'lock' ? t('collections.lockedMessage') : t('submissions.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, collectionId, t]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  const loadMore = async () => {
    if (nextCursor === null || isLoadingMoreRef.current) {
      return;
    }
    isLoadingMoreRef.current = true;
    try {
      const page = await getCollectionSubmissions(authenticatedRequest, collectionId, nextCursor);
      setItems(previous => [...previous, ...page.items.filter(entry => !previous.some(existing => existing.submissionId === entry.submissionId))]);
      setNextCursor(page.nextCursor);
    } catch {
      // The next scroll tries again.
    } finally {
      isLoadingMoreRef.current = false;
    }
  };

  const removeRow = (submissionId: number) => setItems(previous => previous.filter(entry => entry.submissionId !== submissionId));

  const approve = async (submission: CollectionLinkSubmission) => {
    if (busyId !== null) {
      return;
    }
    setBusyId(submission.submissionId);
    try {
      await approveCollectionSubmission(authenticatedRequest, collectionId, submission.submissionId);
      removeRow(submission.submissionId);
      showNotificationToast(t('submissions.approved'));
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.kind === 'notFound') {
        // Already approved or rejected (another device) - it is simply not waiting any more.
        removeRow(submission.submissionId);
      } else if (caughtError instanceof ApiError && caughtError.kind === 'conflict'
        && (caughtError.code === 'linkAlreadyInCollection' || caughtError.code === 'submissionUnavailable')) {
        // The server cleared it: the link is already there, or its proposer deleted it.
        removeRow(submission.submissionId);
        showNotificationToast(caughtError.code === 'linkAlreadyInCollection' ? t('collections.linkAlreadyInCollection') : t('submissions.unavailable'));
      } else {
        showNotificationToast(t('submissions.actionError'));
      }
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (submission: CollectionLinkSubmission) => {
    setPendingReject(null);
    setBusyId(submission.submissionId);
    try {
      await rejectCollectionSubmission(authenticatedRequest, collectionId, submission.submissionId);
      removeRow(submission.submissionId);
      showNotificationToast(t('submissions.rejected'));
    } catch {
      showNotificationToast(t('submissions.actionError'));
    } finally {
      setBusyId(null);
    }
  };

  const renderItem = ({ item }: { item: CollectionLinkSubmission }) => {
    const hostname = getHostnameFromUrl(item.url) ?? item.url;
    const title = item.title?.trim() ? item.title : hostname;
    const isBusy = busyId === item.submissionId;
    return (
      <View style={styles.row} testID={`submission-${item.submissionId}`}>
        <View style={styles.rowMain}>
          {item.previewImageUrl ? (
            <Image source={{ uri: item.previewImageUrl }} style={styles.thumbnail} testID={`submission-thumbnail-${item.submissionId}`} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
              <GlobeIcon color={colors.textSecondary} size={22} />
            </View>
          )}
          <View style={styles.rowText}>
            <Text numberOfLines={2} style={styles.title}>{title}</Text>
            <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{hostname}</Text>
            <View style={styles.proposerRow}>
              {item.proposer?.jupleId ? (
                <>
                  <UserAvatar
                    displayName={item.proposer.displayName}
                    imageUrl={item.proposer.profileImageUrl}
                    imageVersion={item.proposer.profileImageVersion}
                    jupleId={item.proposer.jupleId}
                    size={18}
                  />
                  <Text numberOfLines={1} style={styles.proposer} testID={`submission-proposer-${item.submissionId}`}>
                    {personLabel({ jupleId: item.proposer.jupleId, displayName: item.proposer.displayName })}
                  </Text>
                </>
              ) : (
                <>
                  <UserIcon color={colors.textSecondary} size={14} strokeWidth={2} />
                  <Text numberOfLines={1} style={styles.proposer} testID={`submission-proposer-${item.submissionId}`}>
                    {t('submissions.viaPublicLink')}
                  </Text>
                </>
              )}
              <Text numberOfLines={1} style={styles.time}>· {formatSavedLinkTimestamp(item.submittedAtUtc, 'dateTime')}</Text>
            </View>
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel={t('submissions.rejectA11y', { title })}
            accessibilityRole="button"
            accessibilityState={{ disabled: busyId !== null }}
            disabled={busyId !== null}
            onPress={() => setPendingReject(item)}
            style={[styles.action, styles.rejectAction, busyId !== null && styles.disabled]}
            testID={`submission-reject-${item.submissionId}`}
          >
            <Text style={styles.rejectLabel}>{t('submissions.reject')}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={t('submissions.approveA11y', { title })}
            accessibilityRole="button"
            accessibilityState={{ disabled: busyId !== null, busy: isBusy }}
            disabled={busyId !== null}
            onPress={() => {
              approve(item).catch(() => undefined);
            }}
            style={[styles.action, styles.approveAction, busyId !== null && !isBusy && styles.disabled]}
            testID={`submission-approve-${item.submissionId}`}
          >
            {isBusy ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.approveLabel}>{t('submissions.approve')}</Text>}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <StackScreenSafeArea style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={item => String(item.submissionId)}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <Text style={loadError ? styles.error : styles.empty} testID="submissions-empty">{loadError ?? t('submissions.empty')}</Text>
          )
        }
        onEndReached={() => {
          loadMore().catch(() => undefined);
        }}
        renderItem={renderItem}
        testID="submissions-list"
      />
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
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.sm, padding: spacing.lg },
  loading: { marginTop: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowMain: { flexDirection: 'row', gap: spacing.md },
  thumbnail: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  thumbnailPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  proposerRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: 2 },
  proposer: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, fontWeight: '600' },
  time: { color: colors.textSecondary, flexShrink: 1, fontSize: 12 },
  actions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  action: { alignItems: 'center', borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, minWidth: 88, paddingHorizontal: spacing.md },
  rejectAction: { borderColor: colors.border, borderWidth: 1 },
  approveAction: { backgroundColor: colors.brand },
  rejectLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  approveLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.5 },
});
