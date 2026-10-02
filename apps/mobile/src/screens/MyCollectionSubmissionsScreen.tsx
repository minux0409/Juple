import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getMyCollectionSubmissions, type MyCollectionLinkSubmission, type MyCollectionLinkSubmissionPage } from '../collections/api/collectionsApi';
import { getMyPublicSubmissions } from '../collections/api/publicShareWriteApi';
import { ApiError } from '../api/ApiError';
import { contentGateOfError } from '../collections/useCollectionItems';
import { formatSavedLinkTimestamp } from '../components/SavedLinkMetaRow';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { GlobeIcon } from '../icons/GlobeIcon';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'MyCollectionSubmissions'>;

const THUMBNAIL_SIZE = 56;

/**
 * 내 승인 대기 - the links I proposed to this Collection (승인 후 추가) that its Owner has not answered
 * yet, newest first. View only: the title/preview and site of each as I proposed it, when, and that it
 * is waiting. It is the submitter's own list - never the Owner's approval queue, never anyone else's
 * proposals - and a link leaves it as soon as the Owner approves or declines it (the result itself
 * arrives as a notification). Reloaded on every focus and by pulling down.
 */
export function MyCollectionSubmissionsScreen({ route }: Props) {
  const authenticatedRequest = useAuthenticatedApi();
  // Reached from a Collection I am a member of (its id), or from a public link I proposed through as a
  // non-member (the link's id - I have no Collection access): the same list, a different door.
  const params = route.params;
  const collectionId = 'collectionId' in params ? params.collectionId : null;
  const publicId = 'publicId' in params ? params.publicId : null;
  const fetchPage = useCallback(
    (cursor?: number | null): Promise<MyCollectionLinkSubmissionPage> =>
      publicId !== null
        ? getMyPublicSubmissions(authenticatedRequest, publicId, cursor)
        : getMyCollectionSubmissions(authenticatedRequest, collectionId as number, cursor),
    [authenticatedRequest, collectionId, publicId],
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
        publicId !== null && isUnavailable
          ? t('sharedCollection.unavailableMessage')
          : contentGateOfError(caughtError) === 'lock' ? t('collections.lockedMessage') : t('submissions.myLoadError'),
      );
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [fetchPage, publicId, t]);

  useFocusEffect(
    useCallback(() => {
      load(false).catch(() => undefined);
    }, [load]),
  );

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

  const renderItem = ({ item }: { item: MyCollectionLinkSubmission }) => {
    const hostname = getHostnameFromUrl(item.url) ?? item.url;
    const title = item.title?.trim() ? item.title : hostname;
    return (
      <View
        accessibilityLabel={`${title}, ${t('submissions.myStatus')}`}
        accessible
        style={styles.row}
        testID={`my-submission-${item.submissionId}`}
      >
        {item.previewImageUrl ? (
          <Image source={{ uri: item.previewImageUrl }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <GlobeIcon color={colors.textSecondary} size={22} />
          </View>
        )}
        <View style={styles.rowText}>
          <Text numberOfLines={2} style={styles.title}>{title}</Text>
          <Text numberOfLines={1} style={[styles.meta, ltrTextStyle]}>{hostname}</Text>
          <View style={styles.statusRow}>
            <View style={styles.statusChip}>
              <Text numberOfLines={1} style={styles.statusLabel}>{t('submissions.myStatus')}</Text>
            </View>
            <Text numberOfLines={1} style={styles.time}>{formatSavedLinkTimestamp(item.submittedAtUtc, 'dateTime')}</Text>
          </View>
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
            <Text style={loadError ? styles.error : styles.empty} testID="my-submissions-empty">{loadError ?? t('submissions.myEmpty')}</Text>
          )
        }
        onEndReached={() => {
          loadMore().catch(() => undefined);
        }}
        refreshControl={<RefreshControl onRefresh={() => { load(true).catch(() => undefined); }} refreshing={isRefreshing} />}
        renderItem={renderItem}
        testID="my-submissions-list"
      />
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background, flex: 1 },
  content: { flexGrow: 1, gap: spacing.sm, padding: spacing.lg },
  loading: { marginTop: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, marginTop: spacing.xl, textAlign: 'center' },
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  thumbnail: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  thumbnailPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textSecondary, fontSize: 12 },
  statusRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', marginTop: 2, rowGap: spacing.xs },
  statusChip: { backgroundColor: colors.brandSoft, borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  statusLabel: { color: colors.brand, fontSize: 11, fontWeight: '700' },
  time: { color: colors.textSecondary, flexShrink: 1, fontSize: 12 },
});
