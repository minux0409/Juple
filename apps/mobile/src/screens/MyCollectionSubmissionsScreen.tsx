import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import type { MyCollectionLinkSubmission, MyCollectionLinkSubmissionPage } from '../collections/api/collectionsApi';
import { cancelMyPublicSubmission, getMyPublicSubmissions } from '../collections/api/publicShareWriteApi';
import { PendingSubmissionCard } from '../collections/PendingSubmissionCard';
import { closeOpenRow } from '../components/swipeableRowCoordinator';
import { useCancelSubmission } from '../collections/useCancelSubmission';
import { ApiError } from '../api/ApiError';
import { contentGateOfError } from '../collections/useCollectionItems';
import { ImportantState } from '../components/ImportantState';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'MyCollectionSubmissions'>;


/**
 * 내 승인 대기 - the links I proposed through a public link (승인 후 추가) that the Collection's Owner has not answered
 * yet, newest first. View only: the title/preview and site of each as I proposed it, when, and that it
 * is waiting. It is the submitter's own list - never the Owner's approval queue, never anyone else's
 * proposals - and a link leaves it as soon as the Owner approves or declines it (the result itself
 * arrives as a notification). Reloaded on every focus and by pulling down.
 */
export function MyCollectionSubmissionsScreen({ route }: Props) {
  const authenticatedRequest = useAuthenticatedApi();
  // Reached only from a public link I proposed through as a non-member (the link's id - I have no
  // Collection access). A member's own waiting links are a popup (ApprovalSubmissionSheet) instead.
  const { publicId } = route.params;
  const fetchPage = useCallback(
    (cursor?: number | null): Promise<MyCollectionLinkSubmissionPage> => getMyPublicSubmissions(authenticatedRequest, publicId, cursor),
    [authenticatedRequest, publicId],
  );
  const { t } = useTranslation();
  const [items, setItems] = useState<readonly MyCollectionLinkSubmission[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  // A newer load supersedes an older one still in flight.
  const loadIdRef = useRef(0);

  const load = useCallback(async (refreshing: boolean) => {
    const loadId = ++loadIdRef.current;
    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setLoadError(null);
    try {
      const page = await fetchPage();
      if (loadId !== loadIdRef.current) {
        return;
      }
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (caughtError) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      // The link was switched off, or is protected and not unlocked here: nothing to show, said safely.
      const isUnavailable = caughtError instanceof ApiError && (caughtError.kind === 'notFound' || caughtError.kind === 'forbidden');
      setLoadError(
        isUnavailable
          ? t('sharedCollection.unavailableMessage')
          : contentGateOfError(caughtError) === 'lock' ? t('collections.lockedMessage') : t('submissions.myLoadError'),
      );
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [fetchPage, t]);

  useFocusEffect(
    useCallback(() => {
      load(false).catch(() => undefined);
    }, [load]),
  );

  // 요청 취소 for my own waiting proposal through this link - the same shared behavior as the member popup.
  const cancellation = useCancelSubmission({
    cancel: row => cancelMyPublicSubmission(authenticatedRequest, publicId, row.submissionId),
    onGone: row => setItems(previous => previous.filter(entry => entry.submissionId !== row.submissionId)),
  });

  const loadMore = async () => {
    if (nextCursor === null || isLoadingMoreRef.current) {
      return;
    }
    isLoadingMoreRef.current = true;
    try {
      const page = await fetchPage(nextCursor);
      setItems(previous => [...previous, ...page.items.filter(entry => !previous.some(existing => existing.submissionId === entry.submissionId))]);
      setNextCursor(page.nextCursor);
    } catch {
      // The next scroll tries again.
    } finally {
      isLoadingMoreRef.current = false;
    }
  };

  // The same compact card as the member popup (open the link / cancel the request as icons at its end).
  const renderItem = ({ item }: { item: MyCollectionLinkSubmission }) =>
    cancellation.swipeToCancel(
      { submissionId: item.submissionId, title: item.title, url: item.url },
      <PendingSubmissionCard
        embedded
        row={item}
        trailing={cancellation.renderOpenAction({ submissionId: item.submissionId, title: item.title, url: item.url })}
        variant="mine"
      />,
    );

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
            loadError ? (
              <ImportantState message={loadError} onRetry={() => { load(false).catch(() => undefined); }} testID="my-submissions-empty" />
            ) : (
              <Text style={styles.empty} testID="my-submissions-empty">{t('submissions.myEmpty')}</Text>
            )
          )
        }
        onScrollBeginDrag={closeOpenRow}
        onEndReached={() => {
          loadMore().catch(() => undefined);
        }}
        refreshControl={<RefreshControl onRefresh={() => { load(true).catch(() => undefined); }} refreshing={isRefreshing} />}
        renderItem={renderItem}
        testID="my-submissions-list"
      />
      {cancellation.dialogs}
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { flexGrow: 1, gap: spacing.sm, padding: spacing.lg },
  loading: { marginTop: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
});
