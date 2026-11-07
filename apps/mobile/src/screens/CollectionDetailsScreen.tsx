import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import { useBottomTabBarHeight, type BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Pressable } from '../components/Pressable';
import { TabScreenSafeArea } from '../components/TabScreenSafeArea';
import { usePullToRefresh } from '../components/PullRefreshControl';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { collectionShortcutService } from '../shortcuts/CollectionShortcutService';
import { getCollectionCapabilities } from '../collections/collectionCapabilities';
import {
  deleteCollection,
  addItemToCollection,
  getCollectionShareLink,
  getCollection,
  getCollectionNotificationPreference,
  removeItemFromCollection,
  renameCollection,
  restoreCollection,
  setCollectionColor,
  setCollectionFavorite,
  setCollectionIcon,
  setCollectionNotificationPreference,
  type Collection,
  type CollectionItemEntry,
} from '../collections/api/collectionsApi';
import { CategoryEditorDialog } from '../collections/CategoryEditorDialog';
import { LogoutIcon } from '../icons/LogoutIcon';
import { isCollaborative, isCollectionLocked, isSharedWithMe } from '../collections/collectionAccess';
import { describeItemAdder, shouldShowItemAdders } from '../collections/itemAdder';
import { CollectionLockDialog, type CollectionLockDialogMode } from '../collections/CollectionLockDialog';
import { beginCollectionVisit, getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
import { markCollectionNewLinksRead } from '../notifications/notificationsApi';
import { emitCollectionNewLinksRead, setUnreadCount } from '../notifications/notificationState';
import { CollectionLinkShareSheet } from '../collections/CollectionLinkShareSheet';
import { getCollectionParticipants, leaveCollection, type CollectionParticipants } from '../collections/api/collaborationApi';
import { ApprovalSubmissionSheet } from '../collections/ApprovalSubmissionSheet';
import { CollectionParticipantsSheet } from '../collections/CollectionParticipantsSheet';
import { CollectionUnlockModal } from '../collections/CollectionUnlockModal';
import { CollectionUnlockPanel } from '../collections/CollectionUnlockPanel';
import { CollectionHeaderTitle } from '../collections/CollectionHeaderTitle';
import { useCollectionLinkSelection } from '../collections/useCollectionLinkSelection';
import { CollectionReviewRequestsSheet } from '../collections/CollectionReviewRequestsSheet';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { applyCollectionIconImageChange, getIconImageSaveErrorMessage, type CollectionIconImageChange } from '../collections/collectionIconImage';
import {
  resolveEffectiveCollectionColorValue,
  type CollectionColorValue,
} from '../collections/collectionColors';
import { resolveCollectionIconKey, type CollectionIconKey } from '../collections/collectionIcons';
import { isCollectionLockedError, useCollectionItems } from '../collections/useCollectionItems';
import { CenteredEmptyState } from '../components/CenteredEmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadFailureState } from '../components/LoadFailureState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { SearchField } from '../components/SearchField';
import { useCollectionSearch } from '../collections/useCollectionSearch';
import { useAppToast } from '../components/AppToast';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { isHttpUrl } from '../share/resolveIncomingShare';
import { ParticipantAvatarStack } from '../components/ParticipantAvatarStack';
import { ReactionChips } from '../reactions/ReactionChips';
import { ReactionPickerDialog } from '../reactions/ReactionPickerDialog';
import { useRecentReactions } from '../reactions/recentReactions';
import { useItemReactions } from '../reactions/useItemReactions';
import { edgeAlignedCellPadding, SavedLinkGridCard, savedLinkGridLayout, useSavedLinkGridCellStyle } from '../components/SavedLinkGridCard';
import { gridListKey, useSavedLinkColumns } from '../layout/responsiveGrid';
import { LINK_CONTROLS_BOTTOM_GAP, savedLinkLayout } from '../components/savedLinkLayout';
import { SavedLinkRow } from '../components/SavedLinkRow';
import { SavedLinkRowSkeleton } from '../components/SavedLinkSkeleton';
import { SavedLinkImageRow } from '../components/SavedLinkImageTile';
import { SwipeableItemRow } from '../components/SwipeableItemRow';
import { PendingActionRow } from '../components/PendingActionRow';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { closeOpenRow, useSwipeAwareScrollEnabled } from '../components/swipeableRowCoordinator';
import { FIRST_PAGE_SKELETON_ROWS } from '../components/DateSectionList';
import { BellIcon } from '../icons/BellIcon';
import { BackArrowIcon } from '../icons/BackArrowIcon';
import { ChevronIcon } from '../icons/ChevronIcon';
import { BellOffIcon } from '../icons/BellOffIcon';
import { CopyIcon } from '../icons/CopyIcon';
import { EditIcon } from '../icons/EditIcon';
import { LockIcon } from '../icons/LockIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UnlockIcon } from '../icons/UnlockIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { FavoriteStar, useStarTap } from '../components/FavoriteStar';
import { AnimatedFlatList, CollapsibleHeaderLayout } from '../components/CollapsibleHeaderLayout';
import { LinkIcon } from '../icons/LinkIcon';
import { MoreIcon } from '../icons/MoreIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { buildFlatItemRows, type FlatItemRow } from '../items/flatItemRows';
import { END_REACHED_THRESHOLD, useContinuousViewportFill } from '../items/useContinuousViewportFill';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import type { MainTabParamList } from '../navigation/MainTabs';
import type { CollectionsStackParamList } from '../navigation/CollectionsStack';
import { showCollectionsListAction } from '../navigation/collectionNavigation';
import { useLiveRefresh } from '../push/useLiveRefresh';
import type { SocialPushEventType } from '../push/pushEvents';
import { useViewModePreference, type SavedLinkViewMode } from '../settings/viewModePreference';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';
import { isHandledSubscriptionRefusal } from '../billing/subscriptionRequired';
import { useLeaveWhenCollectionLost } from '../collections/useLeaveWhenCollectionLost';

/** In the 컬렉션 tab's own stack (see CollectionsStack), inside MainTabs, inside the root stack - the link sheet, sharing and the other full-screen flows are root screens. */
type Props = CompositeScreenProps<
  NativeStackScreenProps<CollectionsStackParamList, 'CollectionDetails'>,
  CompositeScreenProps<BottomTabScreenProps<MainTabParamList, 'Collections'>, NativeStackScreenProps<RootStackParamList>>
>;

/** A definitive answer about the Collection itself (gone, signed out) - null for an ordinary failure to load (the standard text). */
function getCollectionLoadNotice(error: unknown, t: TFunction): string | null {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collections.errorNotFound');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return null;
}

function getRenameErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('collections.errorNameConflict');
    }
    if (error.kind === 'badRequest') {
      return t('collections.errorNameInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('collections.errorRenameFallback');
}

function getIconUpdateErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorIconUpdateFallback');
}

function getColorUpdateErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorColorUpdateFallback');
}

function getDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorDeleteFallback');
}

function getRemoveItemErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  return t('collections.errorRemoveItemFallback');
}

function getFavoriteToggleErrorMessage(error: unknown, t: TFunction): string {
  if (isHandledSubscriptionRefusal(error)) {
    return '';
  }
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorFavoriteToggleFallback');
}

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
}

/** Mirrors the backend's CollectionNameNormalizer: trim, required, 100-character limit. */
function getNameValidationError(name: string, t: TFunction): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return t('collections.errorNameRequired');
  }
  if (trimmedName.length > 100) {
    return t('collections.errorNameTooLong');
  }
  return null;
}

/**
 * Adapts a CollectionItemEntry to the shape SavedLinkRow already knows how to render (Home/
 * History - see components/SavedLinkRow.tsx) - itemId/addedAtUtc are this endpoint's own field
 * names for the exact same concepts ItemHistoryEntry calls id/savedAtUtc; every other field is
 * identical. This is purely a display-shape adapter, not a new domain concept - CollectionItemEntry
 * remains the real API type everywhere else in this screen.
 */
// One shared-row object per Collection item, so the memoized image tiles are not redrawn by every render, and a
// tapped tile can name the Collection item it came from.
const rowItemByEntry = new WeakMap<CollectionItemEntry, ItemHistoryEntry>();
const entryByRowItem = new WeakMap<ItemHistoryEntry, CollectionItemEntry>();

function toSavedLinkRowItem(item: CollectionItemEntry): ItemHistoryEntry {
  const cached = rowItemByEntry.get(item);
  if (cached) {
    return cached;
  }
  const rowItem: ItemHistoryEntry = {
    id: item.itemId,
    url: item.url,
    title: item.title,
    memo: item.memo,
    savedAtUtc: item.addedAtUtc,
    representativeImage: item.representativeImage,
    previewImageUrl: item.previewImageUrl,
    coverImage: item.coverImage,
  };
  rowItemByEntry.set(item, rowItem);
  entryByRowItem.set(rowItem, item);
  return rowItem;
}

const collectionItemAccessors = { idOf: (item: CollectionItemEntry) => item.itemId };
type CollectionFlatRow = FlatItemRow<CollectionItemEntry>;

/**
 * A single Collection's detail: rename/delete the Collection itself, and its Item list
 * (newest-added-first, paginated - see useCollectionItems). "Collection에서 제거" only removes the
 * membership row - the Item itself, and its membership in any other Collection, is untouched (see
 * removeItemAction below and CollectionItem's Cascade design in the backend).
 */
const LIVE_REFRESH_EVENTS: readonly SocialPushEventType[] = [
  'collectionContentChanged',
  'collectionItemsAdded',
  'collectionLinkSubmission',
  'collectionLinkSubmissionApproved',
  'collectionLinkSubmissionRejected',
  'collectionInvitationAnswered',
  // A new / answered 참여 요청 changes the Owner's 참여 요청 N row.
  'joinRequest',
];

export function CollectionDetailsScreen({ route, navigation }: Props) {
  const swipeScrollEnabled = useSwipeAwareScrollEnabled();
  const direction = useLayoutDirection();
  // One plane with the app background - the same as Home, 보관함 and the Collections list (header, page, list); the link cards keep
  // their own surface and border on it. Read at render time so a theme change repaints it.
  const pageBackground = colors.background;
  const { collectionId } = route.params;
  // Blocking this Collection's owner (from its participants sheet) ends my membership: the screen leaves once the server says so.
  useLeaveWhenCollectionLost(collectionId, () => navigation.dispatch(showCollectionsListAction(Date.now())));
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const { showNotificationToast, showUndoToast } = useAppToast();
  // Inside the 컬렉션 tab: the Juple tab bar below already reserves the system nav/gesture-area inset (as on the other tab screens),
  // so the layout adds none of its own. Toasts sit above the tab bar, like Home's; the raw inset is still needed by the
  // full-window destination picker sheet.
  const tabBarHeight = useBottomTabBarHeight();
  useToastBottomAnchor(tabBarHeight);

  const [collection, setCollection] = useState<Collection | null>(null);
  const [isLoadingCollection, setIsLoadingCollection] = useState(true);
  const [collectionError, setCollectionError] = useState<{ readonly cause: unknown; readonly notice: string | null } | null>(null);

  // Editing name/icon/color is a centered CategoryEditorDialog now (this round's Category UX
  // rework), not an inline expand-below form - a single editError surfaces whichever step of
  // submitEdit's sequential name/icon/color calls actually failed (see that function's own
  // remarks), shown directly inside the still-open dialog rather than a separate popup.
  const [isEditDialogVisible, setIsEditDialogVisible] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [isLeaveConfirmVisible, setIsLeaveConfirmVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // Mirrors DailyInboxScreen/DateHistoryScreen's SwipeableItemRow usage: one shared in-flight id
  // disables every row's swipe actions while any single row's share/remove is running.
  const [itemActionInFlightId, setItemActionInFlightId] = useState<number | null>(null);

  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [starTap, bumpStar] = useStarTap();

  const [isParticipantsSheetVisible, setIsParticipantsSheetVisible] = useState(false);
  const [ownerRequestSheet, setOwnerRequestSheet] = useState<'review' | 'approvals' | 'join' | null>(null);
  // 참여 요청 (people waiting to join): a bottom sheet of its own, opened from its row or from a 참여 요청 notification.
  const [isMyApprovalSheetVisible, setIsMyApprovalSheetVisible] = useState(false);
  // Emoji reactions to the Collection's links (shared Collections only): the optimistic per-link state,
  // this device's recent picks, and the full picker (opened from the menu's "+", one modal at a time).
  const itemReactions = useItemReactions(
    authenticatedRequest,
    collectionId,
    () => getCollectionUnlockToken(collectionId),
    () => showNotificationToast(t('reactions.error')),
  );
  const { recent: recentReactions, recordRecent: recordRecentReaction } = useRecentReactions();
  const [reactionPickerItem, setReactionPickerItem] = useState<CollectionItemEntry | null>(null);
  // Everyone accepted into a shared Collection (the avatars under its title) - null while unknown or not shared.
  const [participants, setParticipants] = useState<CollectionParticipants | null>(null);
  const [participantsFailed, setParticipantsFailed] = useState(false);

  const [pendingUnlinkItemId, setPendingUnlinkItemId] = useState<number | null>(null);
  const [isCollectionMenuVisible, setIsCollectionMenuVisible] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  // 새 링크 알림 - the caller's own setting for this Collection (null until loaded / not offered).
  const [newLinkNotifications, setNewLinkNotifications] = useState<boolean | null>(null);
  const notificationRequestRef = useRef(0);
  // A member's way to pass on the Owner's public link: its URL while it is on (checked on every
  // focus with the Collection itself, so a link the Owner turned off elsewhere disappears then).
  const [memberShareUrl, setMemberShareUrl] = useState<string | null>(null);
  const [isCheckingShareLink, setIsCheckingShareLink] = useState(false);
  const [isLinkShareSheetVisible, setIsLinkShareSheetVisible] = useState(false);
  const [lockDialogMode, setLockDialogMode] = useState<CollectionLockDialogMode | null>(null);
  // An Owner management action (edit/delete/share) waiting for the password on a locked Collection;
  // it runs right after a successful unlock, so the user never has to find the menu again.
  const [pendingUnlockAction, setPendingUnlockAction] = useState<(() => void) | null>(null);

  // Independent of view mode on purpose - switching List/Grid must never reset the chosen sort
  // (this round's explicit "View mode를 바꿔도 현재 sort 유지" requirement). Both are separately
  // persisted screen preferences (see viewModePreference.ts/sortPreference.ts), not one combined
  // state.
  const { viewMode, changeViewMode } = useViewModePreference('collectionDetailsViewMode');
  // Responsive Grid: more columns on a wider window (phone: 2 cards / 3 image tiles, as always) - see layout/responsiveGrid.
  const columns = useSavedLinkColumns();
  const gridCellStyle = useSavedLinkGridCellStyle();
  const [searchText, setSearchText] = useState('');
  const layoutMode: SavedLinkViewMode = viewMode;
  // The Collection's links are ONE list, always newest added first (the server's order: added time, then id), a page at a
  // time as it scrolls - no date sections to open and no other order to pick. A search shows the server's results in the
  // same order.
  const search = useCollectionSearch(collectionId, searchText, 'dateDesc');
  const refreshSearch = search.refresh;
  const paged = useCollectionItems(collectionId, 'dateDesc');
  const { isLoading, isRefreshing, error, items, refresh } = paged;
  // Locked (or share-password protected) with no valid grant: nothing of the content is on screen, only the unlock panel.
  const isContentLocked = paged.isLocked;
  const contentLockKind = paged.lockKind;
  const removeLocally = (itemId: number) => {
    paged.removeLocally(itemId);
    search.removeItem(itemId);
  };
  // Image: the loaded links packed three to a line (List / Grid list the links themselves).
  const imageRows = useMemo<readonly CollectionFlatRow[]>(
    () => (layoutMode === 'image' ? buildFlatItemRows(items, 'image', collectionItemAccessors, columns) : []),
    [columns, items, layoutMode],
  );
  // Search results: one flat run in the server's date order (the search endpoint has no name order, so a name-sorted
  // Collection shows the same newest-first results while searching) - from the one server search.
  const searchRows = useMemo<readonly CollectionFlatRow[]>(
    () => (search.isSearching ? buildFlatItemRows(search.items, layoutMode, collectionItemAccessors, columns) : []),
    [columns, layoutMode, search.isSearching, search.items],
  );
  // The search result list fills itself while the loaded links do not fill the viewport (dense Image lines would
  // otherwise never ask for another page).
  const advanceSearch = () => {
    if (search.hasMore && !search.isLoading && !search.isLoadingMore && !search.error) {
      search.loadMore();
    }
  };
  const fillKey = useMemo(
    () => [search.items, search.isLoading, search.isLoadingMore, search.error, search.hasMore],
    [search.error, search.hasMore, search.isLoading, search.isLoadingMore, search.items],
  );
  const viewportFill = useContinuousViewportFill({ advance: advanceSearch, dataKey: fillKey, enabled: search.isSearching && !isContentLocked });
  // One stable callback for every (memoized) image tile - the same open path as a card's tap (set below, where the
  // Collection is known).
  const openCollectionItemRef = useRef<(item: CollectionItemEntry) => void>(() => undefined);
  const openLinkInBrowserRef = useRef<(url: string) => void>(() => undefined);
  const openImageTile = useCallback((rowItem: ItemHistoryEntry) => {
    const entry = entryByRowItem.get(rowItem);
    if (entry) {
      openCollectionItemRef.current(entry);
    }
  }, []);
  // The image tiles' swipe (set below, where the Collection is known): 컬렉션에서 제거 for what this person may remove, 공유.
  const imageSwipeHandlersRef = useRef<{ unlink: (itemId: number) => void; share: (item: CollectionItemEntry) => void }>({ unlink: () => undefined, share: () => undefined });
  const baseImageSwipeActions = useMemo(() => ({
    onDelete: (rowItem: ItemHistoryEntry) => imageSwipeHandlersRef.current.unlink(rowItem.id),
    onShare: (rowItem: ItemHistoryEntry) => {
      const entry = entryByRowItem.get(rowItem);
      if (entry) {
        imageSwipeHandlersRef.current.share(entry);
      }
    },
  }), []);
  // Who added each link - only where more than one person can add (see shouldShowItemAdders).
  const showItemAdders = shouldShowItemAdders(collection, items);

  // A newer load supersedes an older one still in flight: only the latest response is applied, so a
  // slow earlier request can never overwrite fresher state (e.g. the pending-approval count).
  const collectionLoadIdRef = useRef(0);
  const loadCollection = useCallback(async () => {
    const loadId = ++collectionLoadIdRef.current;
    setIsLoadingCollection(true);
    setCollectionError(null);
    try {
      const fetched = await getCollection(authenticatedRequest, collectionId);
      if (loadId !== collectionLoadIdRef.current) {
        return;
      }
      setCollection(fetched);
      if (isCollaborative(fetched)) {
        getCollectionParticipants(authenticatedRequest, collectionId)
          .then(loaded => {
            if (loadId === collectionLoadIdRef.current) {
              setParticipants(loaded);
              setParticipantsFailed(false);
            }
          })
          .catch(() => {
            if (loadId === collectionLoadIdRef.current) {
              setParticipantsFailed(true);
            }
          });
      } else {
        setParticipants(null);
      }
      if (isSharedWithMe(fetched)) {
        getCollectionShareLink(authenticatedRequest, collectionId)
          .then(setMemberShareUrl)
          .catch(() => setMemberShareUrl(null));
      } else {
        setMemberShareUrl(null);
      }
    } catch (caughtError) {
      if (loadId === collectionLoadIdRef.current) {
        setCollectionError({ cause: caughtError, notice: getCollectionLoadNotice(caughtError, t) });
      }
    } finally {
      if (loadId === collectionLoadIdRef.current) {
        setIsLoadingCollection(false);
      }
    }
  }, [authenticatedRequest, collectionId, t]);

  // Pull-to-refresh reloads everything server-derived on this screen - the Collection itself (its
  // 승인 대기 count, link count, participants, share state) AND its links - not just the link list.
  // Works on its own even if a Push was missed. A second pull while one is running joins it instead
  // of starting duplicate requests.
  const refreshInFlightRef = useRef<Promise<unknown> | null>(null);
  const refreshAll = useCallback(() => {
    if (refreshInFlightRef.current) {
      return;
    }
    refresh();
    refreshSearch();
    refreshInFlightRef.current = loadCollection().finally(() => {
      refreshInFlightRef.current = null;
    });
  }, [loadCollection, refresh, refreshSearch]);
  const pullToRefresh = usePullToRefresh(isRefreshing, refreshAll);

  // A Push about this open Collection (a proposal, a decision, new links...) refreshes the same state.
  useLiveRefresh(
    event => {
      if (event === null || event.collectionId === collectionId) {
        refreshAll();
      }
    },
    LIVE_REFRESH_EVENTS,
  );

  // Refetches the Collection's own metadata (Name/ItemCount/participants) on every focus - entirely
  // independent of useCollectionItems' own focus-driven Item list load, mirroring ItemDetailsScreen's
  // Purchases/RepeatPurchases independence.
  // Owner vs Contributor always comes from the server's accessRole - never inferred here. Every
  // Owner-only control below is hidden for a Contributor, and the server independently refuses
  // them (403) regardless.
  const isOwner = collection !== null && !isSharedWithMe(collection);
  const removeFromCollectionLabel = t('collections.removeFromCollection');
  const imageSwipeActions = useMemo(() => ({
    ...baseImageSwipeActions,
    deleteLabel: removeFromCollectionLabel,
    // The same rule as a card: the Owner any link, a member only what they added (the server enforces it too).
    canDelete: (rowItem: ItemHistoryEntry) => isOwner || entryByRowItem.get(rowItem)?.isMine !== false,
  }), [baseImageSwipeActions, isOwner, removeFromCollectionLabel]);
  // Long-press on a link starts multi-selection (see useCollectionLinkSelection): the bottom bar's actions follow the Collection's kind
  // and the authors of the chosen links. Handlers that need things defined further down are read when pressed.
  const linkSelection = useCollectionLinkSelection({
    collectionId,
    collection,
    isOwner,
    isContentLocked,
    isLoading: isLoading || isRefreshing || search.isLoading,
    reactionsEnabled: !isContentLocked && collection !== null && (isSharedWithMe(collection) || collection.hasCollaborators === true),
    loadedItems: search.isSearching ? search.items : items,
    onRemoved: ids => {
      ids.forEach(removeLocally);
      setCollection(previous => (previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - ids.length) } : previous));
    },
    onChanged: () => { loadCollection().catch(() => undefined); refresh(); },
    onOpenOriginal: url => openLinkInBrowserRef.current(url),
    onEditOwn: item => openCollectionItemRef.current(item),
    onSaveOther: item => {
      if (isHttpUrl(item.url)) {
        navigation.navigate('NewLinkReview', { url: item.url, initialTitle: item.title ?? null, preselectedCollectionId: null });
      }
    },
    onReact: item => setReactionPickerItem(item),
    onNotice: message => setNotice(message),
  });
  const startSelectionRef = useRef(linkSelection.startSelection);
  startSelectionRef.current = linkSelection.startSelection;
  // One stable long-press for the (memoized) image tiles.
  const startImageSelection = useCallback((rowItem: ItemHistoryEntry) => {
    const entry = entryByRowItem.get(rowItem);
    if (entry) {
      startSelectionRef.current(entry);
    }
  }, []);
  // Whatever this screen learns about the Collection (opened, renamed, locked, role changed) also keeps its app shortcut
  // right - a renamed one gets the new label, a locked or read-only one is removed - with no request of its own.
  useEffect(() => {
    if (collection) {
      collectionShortcutService.applyKnownCollections([collection]).catch(() => undefined);
    }
  }, [collection]);

  // 새 링크 알림 is offered wherever someone else can add links: a Collection shared with the caller,
  // or the caller's own one that has members or a public link. It is the header's bell - one tap
  // turns it on or off, no dialog.
  const offersNewLinkNotifications = collection !== null && isCollaborative(collection);
  useEffect(() => {
    if (!offersNewLinkNotifications) {
      setNewLinkNotifications(null);
      return undefined;
    }
    let isCurrent = true;
    getCollectionNotificationPreference(authenticatedRequest, collectionId)
      .then(preference => {
        if (isCurrent) {
          setNewLinkNotifications(preference.newItemNotificationsEnabled);
        }
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [authenticatedRequest, collectionId, offersNewLinkNotifications]);

  /** Flips at once; a failed save flips it back and says so briefly (only the latest change counts). */
  const changeNewLinkNotifications = (enabled: boolean) => {
    const previous = newLinkNotifications;
    const requestId = ++notificationRequestRef.current;
    setNewLinkNotifications(enabled);
    setCollectionNotificationPreference(authenticatedRequest, collectionId, enabled).catch(() => {
      if (requestId === notificationRequestRef.current) {
        setNewLinkNotifications(previous);
        showNotificationToast(t('collections.newLinkNotificationsError'));
      }
    });
  };

  /**
   * The link's state right now, from the server - never the URL this screen loaded earlier (the
   * Owner may have turned it off on another device meanwhile). Off: sharing disappears here and the
   * user is told; null is returned. A failed check shares nothing either.
   */
  const fetchLiveShareUrl = async (): Promise<string | null> => {
    try {
      const url = await getCollectionShareLink(authenticatedRequest, collectionId);
      if (!url) {
        setMemberShareUrl(null);
        setIsLinkShareSheetVisible(false);
        showNotificationToast(t('collections.publicShareEnded'));
        return null;
      }
      setMemberShareUrl(url);
      return url;
    } catch {
      showNotificationToast(t('linkShare.checkFailed'));
      return null;
    }
  };

  /** A member's share icon: 친구 / ID / 외부 공유 - only once the server confirms the link is still public. */
  const openMemberLinkShare = async () => {
    if (isCheckingShareLink) {
      return;
    }
    setIsCheckingShareLink(true);
    try {
      if (await fetchLiveShareUrl()) {
        setIsLinkShareSheetVisible(true);
      }
    } finally {
      setIsCheckingShareLink(false);
    }
  };

  /** 외부 공유: checked once more, then the OS share sheet with the URL as the server has it now. */
  const shareLinkExternally = async () => {
    const url = await fetchLiveShareUrl();
    if (url && collection) {
      await shareItem(url, collection.name).catch(() => undefined);
      setIsLinkShareSheetVisible(false);
    }
  };

  // An unlock lasts for this visit only: while this screen is on the stack (child screens, sheets
  // and dialogs included) the grant is reused; once the user leaves the Collection it is forgotten,
  // and coming back asks for the password again.
  useEffect(() => beginCollectionVisit(collectionId), [collectionId]);

  useFocusEffect(
    useCallback(() => {
      loadCollection();
    }, [loadCollection]),
  );

  // Notification links can reach the already-focused screen, so each token reloads it once.
  const reloadForTokenRef = useRef(() => {});
  reloadForTokenRef.current = () => {
    loadCollection();
    refresh();
  };
  useEffect(() => {
    if (route.params.refreshToken === undefined) {
      return;
    }
    navigation.setParams({ refreshToken: undefined });
    reloadForTokenRef.current();
  }, [route.params.refreshToken, navigation]);

  // The content is really open: the Collection and its links loaded, past its lock / share-password gate.
  const isContentOpen = collection !== null && !isLoadingCollection && !isLoading && error === null && !isContentLocked;

  // Opening the Collection is reading its 새 링크 notifications (best-effort - a failure only leaves
  // the badge until next time). Its 승인 대기 count is a task, not a notification: untouched here.
  useFocusEffect(
    useCallback(() => {
      if (!isContentOpen) {
        return;
      }
      markCollectionNewLinksRead(authenticatedRequest, collectionId)
        .then(result => {
          setUnreadCount(result.unreadCount);
          if (result.markedCount > 0) {
            emitCollectionNewLinksRead(collectionId);
          }
        })
        .catch(() => undefined);
    }, [authenticatedRequest, collectionId, isContentOpen]),
  );

  // A 승인 요청 notification: once the content is open (the lock / share-password gate passed, as for any
  // visit) the Owner's 링크 승인 대기 popup opens over this Collection. Once per notification.
  const openApprovals = route.params.openApprovals === true;
  useEffect(() => {
    if (!openApprovals || !isContentOpen || collection === null) {
      return;
    }
    navigation.setParams({ openApprovals: undefined });
    if (!isSharedWithMe(collection)) {
      setOwnerRequestSheet('approvals');
    }
  }, [collection, isContentOpen, navigation, openApprovals]);

  // A 참여 요청 notification: once the content is open (the lock / share-password gate passed, as for any visit) the Owner is taken
  // to the 참여 요청 bottom sheet - the same one the 참여 요청 N row opens. Once per notification; nothing opens if the gate is not passed or it is not the Owner's.
  const openJoinRequests = route.params.openJoinRequests === true;
  useEffect(() => {
    if (!openJoinRequests || !isContentOpen || collection === null) {
      return;
    }
    navigation.setParams({ openJoinRequests: undefined });
    if (!isSharedWithMe(collection)) {
      setOwnerRequestSheet('join');
    }
  }, [collection, isContentOpen, navigation, openJoinRequests]);

  // A reaction/comment notification on my link here: once the content is open (so the gate and the
  // visit's unlock apply exactly as for any visit), the link opens IN this Collection - its reactions
  // and comments shown, scrolled to the comments for a comment. Once per notification.
  const openItem = route.params.openItem;
  useEffect(() => {
    if (!openItem || !isContentOpen || collection === null) {
      return;
    }
    navigation.setParams({ openItem: undefined });
    const ownsCollection = !isSharedWithMe(collection);
    if (openItem.shared) {
      // Somebody else's link (a reply / heart on my comment there): its read-only view, with that thread opened.
      navigation.navigate('ItemDetails', {
        itemId: openItem.itemId,
        collectionContext: { collectionId, canRemove: ownsCollection, isCollectionOwner: ownsCollection, isCollaborative: true, readOnly: true },
        initialFocusThreadRootId: openItem.commentRootId ?? null,
        ...(openItem.focus === 'comments' ? { initialFocus: 'comments' as const } : {}),
      });
      return;
    }
    navigation.navigate('ItemDetails', {
      itemId: openItem.itemId,
      // My own link (the server only targets the recipient's own link): removable from here like any of mine.
      collectionContext: {
        collectionId,
        canRemove: true,
        isCollectionOwner: ownsCollection,
        isCollaborative: isSharedWithMe(collection) || collection.hasCollaborators === true,
      },
      ...(openItem.focus === 'comments' ? { initialFocus: 'comments' as const } : {}),
      ...(openItem.commentRootId ? { initialFocusThreadRootId: openItem.commentRootId } : {}),
    });
  }, [collection, collectionId, isContentOpen, navigation, openItem]);

  /**
   * Managing a locked Collection (edit, delete, share) needs the same unlock grant as its content -
   * the server refuses these without one. With a valid grant from this session the action runs at
   * once; otherwise the password prompt opens first and the action resumes after it succeeds.
   */
  const runUnlocked = (action: () => void) => {
    if (collection && isCollectionLocked(collection) && getCollectionUnlockToken(collectionId) === null) {
      setPendingUnlockAction(() => action);
      return;
    }
    action();
  };

  /** The Owner's 공유: the one Share screen (after the password prompt of a locked Collection) - the header icon and the list's long-press menu both come here. */
  const openOwnerShare = () => runUnlocked(() => navigation.navigate('CollectionShare', { collectionId }));

  const openEditDialog = () => {
    if (!collection || isSavingEdit) {
      return;
    }
    setEditError(null);
    setIsEditDialogVisible(true);
  };

  const cancelEditName = () => {
    if (isSavingEdit) {
      return;
    }
    setIsEditDialogVisible(false);
    setEditError(null);
  };

  /**
   * Saves the name/icon/color edit fields together (one dialog, one Save button - see
   * CategoryEditorDialog), but calls their independent endpoints sequentially, never via
   * Promise.all: all three mutate the same Collection row's RowVersion (see backend
   * CollectionStore.RenameAsync/SetIconAsync/SetColorAsync), so firing them concurrently risks one
   * losing an optimistic-concurrency race against another. A name change that succeeds followed by
   * an icon or color change that fails is left applied (not rolled back) - the same "each attribute
   * is its own independent action" contract this screen's favorite/share/delete actions already
   * follow, not an all-or-nothing transaction. On any failure the dialog stays open (isEditDialogVisible
   * untouched) showing editError, so the user can see exactly what happened and retry.
   */
  const submitEdit = async (name: string, icon: CollectionIconKey, color: CollectionColorValue, imageChange: CollectionIconImageChange) => {
    if (isSavingEdit || !collection) {
      return;
    }

    const validationError = getNameValidationError(name, t);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    const trimmedName = name.trim();
    const nameChanged = trimmedName !== collection.name;
    const iconChanged = icon !== resolveCollectionIconKey(collection.icon);
    const colorChanged = color !== resolveEffectiveCollectionColorValue(collection.color, collection.id);
    const imageChanged = imageChange.kind === 'set' || (imageChange.kind === 'remove' && !!collection.iconImageUrl);

    if (!nameChanged && !iconChanged && !colorChanged && !imageChanged) {
      setIsEditDialogVisible(false);
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    if (nameChanged) {
      try {
        await renameCollection(authenticatedRequest, collectionId, trimmedName);
        setCollection(previous => (previous ? { ...previous, name: trimmedName } : previous));
      } catch (caughtError) {
        setEditError(getRenameErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (iconChanged) {
      try {
        const updated = await setCollectionIcon(authenticatedRequest, collectionId, icon);
        setCollection(updated);
      } catch (caughtError) {
        setEditError(getIconUpdateErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (colorChanged) {
      try {
        const updated = await setCollectionColor(authenticatedRequest, collectionId, color);
        setCollection(updated);
      } catch (caughtError) {
        setEditError(getColorUpdateErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    if (imageChanged) {
      try {
        setCollection(await applyCollectionIconImageChange(authenticatedRequest, collection, imageChange));
      } catch (caughtError) {
        setEditError(getIconImageSaveErrorMessage(caughtError, t));
        setIsSavingEdit(false);
        return;
      }
    }

    setIsEditDialogVisible(false);
    setIsSavingEdit(false);
  };

  const deleteCollectionAction = async () => {
    if (isDeletingCollection) {
      return;
    }

    setIsDeletingCollection(true);
    try {
      await deleteCollection(authenticatedRequest, collectionId);
      // A deleted Collection leaves the app shortcuts at once (a restore does not bring it back - that is the user's choice).
      collectionShortcutService.unpin(collectionId).catch(() => undefined);
      showUndoToast({
        actionLabel: t('toast.undoAction'),
        message: t('toast.collectionDeleteSuccess'),
        onUndo: async () => {
          await restoreCollection(authenticatedRequest, collectionId);
          navigation.dispatch(showCollectionsListAction(Date.now()));
        },
        undoErrorMessage: t('toast.undoCollectionDeleteError'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'),
      });
      // Back to the Collections list already under this screen - never a new one (replace, or navigate in
      // React Navigation 7, would mount a fresh list and lose its filter; the other tabs keep their state).
      // The refreshToken makes Collections reload.
      navigation.dispatch(showCollectionsListAction(Date.now()));
    } catch (caughtError) {
      setNotice(getDeleteErrorMessage(caughtError, t));
    } finally {
      setIsDeletingCollection(false);
    }
  };

  // A member (not the Owner) leaves: the Collection leaves my list, so close it and land on Collections, refreshed.
  const leaveCollectionAction = async () => {
    if (isLeaving) {
      return;
    }
    setIsLeaving(true);
    try {
      await leaveCollection(authenticatedRequest, collectionId);
      collectionShortcutService.unpin(collectionId).catch(() => undefined);
      navigation.dispatch(showCollectionsListAction(Date.now()));
    } catch {
      setNotice(t('collections.leaveError'));
    } finally {
      setIsLeaving(false);
    }
  };

  const confirmDeleteCollection = () => {
    if (isDeletingCollection) {
      return;
    }
    setIsDeleteConfirmVisible(true);
  };

  // The Collections list's long-press menu asked for one of this screen's own actions (see RootStack's pendingAction): it
  // runs once the Collection is loaded, through exactly what this screen's ⋯ menu runs (including the password prompt for
  // a locked Collection), and only if the caller may do it - a stale or tampered param opens nothing.
  const pendingAction = route.params.pendingAction;
  useEffect(() => {
    if (!pendingAction || collection === null) {
      return;
    }
    navigation.setParams({ pendingAction: undefined });
    const capabilities = getCollectionCapabilities(collection);
    if (pendingAction === 'edit' && capabilities.canEdit) {
      runUnlocked(openEditDialog);
    } else if (pendingAction === 'lock' && (capabilities.canChangeLock || capabilities.canChangeMemberLock)) {
      // The Owner's Collection lock, or - for a member - their own personal lock (isMemberLocked), never each other's.
      const lockedForMe = capabilities.isOwner ? isCollectionLocked(collection) : collection.isMemberLocked === true;
      setLockDialogMode(lockedForMe ? 'remove' : 'lock');
    } else if (pendingAction === 'delete' && capabilities.canDelete) {
      runUnlocked(confirmDeleteCollection);
    } else if (pendingAction === 'leave' && capabilities.canLeave) {
      setIsLeaveConfirmVisible(true);
    } else if (pendingAction === 'share' && capabilities.canShare) {
      // Exactly the header icon's handlers: the Owner's Share screen, or a member's re-checked public link.
      if (capabilities.isOwner) {
        openOwnerShare();
      } else {
        openMemberLinkShare().catch(() => undefined);
      }
    }
    // The handlers are re-created every render; this reacts only to the request itself and the loaded Collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, navigation, pendingAction]);

  const removeItemAction = async (itemId: number) => {
    if (itemActionInFlightId !== null) {
      return;
    }

    setItemActionInFlightId(itemId);
    try {
      await removeItemFromCollection(authenticatedRequest, collectionId, itemId);
      removeLocally(itemId);
      setCollection(previous =>
        previous ? { ...previous, itemCount: Math.max(0, previous.itemCount - 1) } : previous,
      );
      // Undo puts the link back - only for someone who may add links here (a member who is now a
      // Viewer removed their own link for good, so no undo is offered that would fail).
      if (isOwner || collection?.accessRole === 'contributor') {
        showUndoToast({ actionLabel: t('toast.undoAction'), message: t('toast.unlinkSuccess'), noticeTitle: t('common.notice'), confirmLabel: t('common.confirm'), undoErrorMessage: t('toast.undoUnlinkError'), onUndo: async () => {
          await addItemToCollection(authenticatedRequest, collectionId, itemId);
          setCollection(previous => previous ? { ...previous, itemCount: previous.itemCount + 1 } : previous);
          await refresh();
        } });
      } else {
        showNotificationToast(t('toast.unlinkSuccess'));
      }
    } catch (caughtError) {
      setNotice(getRemoveItemErrorMessage(caughtError, t));
    } finally {
      setItemActionInFlightId(null);
    }
  };

  /** Shares the Item's original URL as-is via the OS Share Sheet - never a Juple-branded link. */
  const shareItemAction = async (item: CollectionItemEntry) => {
    if (itemActionInFlightId !== null) {
      return;
    }

    setItemActionInFlightId(item.itemId);
    try {
      await shareItem(item.url, item.title);
    } catch {
      setNotice(getShareErrorMessage(t));
    } finally {
      setItemActionInFlightId(null);
    }
  };

  const toggleFavoriteAction = async () => {
    if (!collection || isTogglingFavorite) {
      return;
    }
    const desiredIsFavorite = !collection.isFavorite;

    setIsTogglingFavorite(true);
    setCollection(previous => (previous ? { ...previous, isFavorite: desiredIsFavorite } : previous));
    try {
      const updated = await setCollectionFavorite(authenticatedRequest, collectionId, desiredIsFavorite);
      setCollection(updated);
    } catch (caughtError) {
      // Roll back the optimistic flip - never trust it once the request has failed.
      setCollection(previous => (previous ? { ...previous, isFavorite: !desiredIsFavorite } : previous));
      setNotice(getFavoriteToggleErrorMessage(caughtError, t));
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  const confirmUnlinkItem = (itemId: number) => {
    setPendingUnlinkItemId(previous => previous ?? itemId);
  };

  const openLinkInBrowser = (url: string) => {
    // No Linking.canOpenURL pre-check - see ItemDetailsScreen.openOriginalUrl (Android package visibility).
    Linking.openURL(url).catch(() => setNotice(t('item.urlOpenFailed')));
  };
  openLinkInBrowserRef.current = openLinkInBrowser;

  const backButton = (
    <Pressable accessibilityLabel={t('common.back')} accessibilityRole="button"
      onPress={() => navigation.goBack()} style={styles.toolbarButton} testID="collection-details-back">
      <BackArrowIcon color={colors.textPrimary} />
    </Pressable>
  );
  if (!collection) {
    return (
      <TabScreenSafeArea style={styles.safeArea}>
        <View style={styles.navigationBar}>{backButton}</View>
        <View style={styles.loadingContainer}>
          {isLoadingCollection ? <ActivityIndicator /> :
            collectionError ? <LoadFailureState error={collectionError.cause} notice={collectionError.notice} onRetry={() => { loadCollection().catch(() => undefined); }} testID="collection-details-error" /> : null}
        </View>
      </TabScreenSafeArea>
    );
  }

  const reactionsEnabled = !isContentLocked && (isSharedWithMe(collection) || collection.hasCollaborators === true);
  /** A reaction chosen for a link (quick row, picker or a chip): remembered as recent, then sent. */
  const reactToItem = (item: CollectionItemEntry, key: string) => {
    recordRecentReaction(key);
    itemReactions.react(item.itemId, item, key).catch(() => undefined);
  };
  // The participant row exists from the first render whenever someone else is in the Collection (the
  // Collection itself says how many) - placeholder circles until the full list arrives, then the real
  // photos in the same place. Never a line of names. If the list cannot be loaded, the Collection's own
  // preview of people stands in (initials), still as circles.
  const otherParticipants = collection.otherParticipantCount ?? collection.participantPreview?.length ?? 0;
  const showParticipantStack = otherParticipants > 0;
  const stackParticipants = participants
    ? participants.participants
    : participantsFailed
      ? collection.participantPreview ?? []
      : null;

  /**
   * One link of this Collection as a swipeable List row or Grid tile - the same in the flat 이름순
   * list and inside a 시간순 date section (which passes its accordion card's own row style).
   */
  const openCollectionItem = (item: CollectionItemEntry) => {
    if (item.isMine !== false) {
      // Opened from this Collection: its delete action removes the link from here only.
      navigation.navigate('ItemDetails', { itemId: item.itemId, collectionContext: { collectionId, canRemove: true, isCollectionOwner: isOwner, isCollaborative: reactionsEnabled } });
    } else {
      navigation.navigate('ItemDetails', {
        itemId: item.itemId,
        // Another member's link: the same sheet, read-only; only the Owner may take it out of this Collection (the server checks too).
        collectionContext: { collectionId, canRemove: isOwner, isCollectionOwner: isOwner, isCollaborative: true, readOnly: true },
      });
    }
  };
  openCollectionItemRef.current = openCollectionItem;
  imageSwipeHandlersRef.current = { unlink: confirmUnlinkItem, share: item => { shareItemAction(item).catch(() => undefined); } };

  // `column`: the item's column in a Grid row on the screen's content edge (see edgeAlignedCellPadding).
  const renderCollectionItem = (item: CollectionItemEntry, containerStyle?: StyleProp<ViewStyle>, column?: number) => {
    // Another member's link: opened as the read-only shared view (the owner-only ItemDetails
    // would be a 404 anyway), and never offered Add/Move - those act on one's own Items.
    const isMine = item.isMine !== false;
    // Reactions: only in a Collection other people are in (shared with me, or mine with members), once its
    // content is open - never in a private one, and never in the public link's views.
    const addedBy = showItemAdders ? describeItemAdder(item.addedBy, t) : null;
    const reactionState = reactionsEnabled ? itemReactions.reactionsOf(item.itemId, item) : null;
    const reactionFooter = reactionState ? (
      <ReactionChips
        onAdd={() => setReactionPickerItem(item)}
        onToggle={key => reactToItem(item, key)}
        reactions={reactionState}
        testID={`reaction-chips-${item.itemId}`}
      />
    ) : undefined;
    // The frame is the same one Home/History use (see savedLinkLayout.ts): a List card, or a Grid tile
    // inside its 50% cell. A caller that places the item itself (a date section) passes its own frame.
    const isGrid = layoutMode === 'grid';
    const wrapInGridCell = isGrid && containerStyle === undefined;
    const frameStyle = containerStyle ?? (isGrid ? savedLinkGridLayout.swipeContainer : savedLinkLayout.card);
    const cellStyle = column === undefined ? gridCellStyle : [gridCellStyle, edgeAlignedCellPadding(column, columns.grid)];
    const inCell = (node: ReactElement) => (wrapInGridCell ? <View style={cellStyle}>{node}</View> : node);
    // 바로가기 (List and Grid cards): the saved original page; the card's own tap still opens the link in this app.
    const openOriginal = () => openLinkInBrowser(item.url);
    return inCell(
      <SwipeableItemRow
        containerStyle={frameStyle}
        deleteBehavior={layoutMode === 'grid' ? 'reveal' : 'confirm'}
        disabled={itemActionInFlightId !== null || isRefreshing}
        onOpenOriginal={isContentLocked ? undefined : openOriginal}
        // 컬렉션에서 제거 (never deletes anyone's Item): the Owner any link; a member only the links
        // they added themselves (their own Items) - the server enforces the same.
        onDelete={isOwner || isMine ? () => confirmUnlinkItem(item.itemId) : undefined}
        deleteLabel={t('collections.removeFromCollection')}
        // Long-press opens the 복제/이동 menu in both List and Grid - the one way in (a List row no
        // longer has its own trailing "..." for it).
        onLongPress={isContentLocked ? undefined : () => linkSelection.startSelection(item)}
        selection={linkSelection.rowSelection(item)}
        onPress={() => openCollectionItem(item)}
        onShare={() => shareItemAction(item)}
      >
        {/* Exactly Home/History's own row/tile - see SavedLinkRow.tsx/SavedLinkGridCard.tsx -
            so a Category's link cards are visually indistinguishable from the same Item shown
            anywhere else in the app. dateDisplayMode="dateTime" (not the default "time")
            because a Category's items span arbitrary dates, never a single grouped day the way
            a History section does - matches this row's own prior "always show the full date"
            behavior exactly - Grid passes the same mode, so both show the identical timestamp. */}
        {layoutMode === 'grid' ? (
          <SavedLinkGridCard addedBy={addedBy} dateDisplayMode="dateTime" onOpenOriginal={openOriginal} reactions={reactionFooter} isActionInFlight={itemActionInFlightId === item.itemId} item={toSavedLinkRowItem(item)} preferEffectiveThumbnail />
        ) : (
          <SavedLinkRow
            addedBy={addedBy}
            dateDisplayMode="dateTime"
            onOpenOriginal={openOriginal}
            reactions={reactionFooter}
            isActionInFlight={itemActionInFlightId === item.itemId}
            item={toSavedLinkRowItem(item)}
            preferEffectiveThumbnail
          />
        )}
      </SwipeableItemRow>
    );
  };

  const closeCollectionMenuThen = (action: () => void) => () => {
    setIsCollectionMenuVisible(false);
    action();
  };

  // The Collection's ⋯ menu - what this caller may do, in a fixed order. The Owner: 수정, the lock,
  // Keep the destructive delete action last.
  const collectionMenuActions: ActionMenuDialogAction[] = isOwner
    ? [
        { label: t('common.edit'), icon: EditIcon, onPress: closeCollectionMenuThen(() => runUnlocked(openEditDialog)) },
        // The lock password itself is managed only in Settings > 컬렉션 잠금 - here a Collection is
        // just locked (a confirmation) or unlocked (that password).
        isCollectionLocked(collection)
          ? { label: t('collections.lockRemoveAction'), destructive: true, icon: UnlockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('remove')) }
          : { label: t('collections.lockSetTitle'), icon: LockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('lock')) },
        { label: t('common.delete'), destructive: true, icon: TrashIcon, onPress: closeCollectionMenuThen(() => runUnlocked(confirmDeleteCollection)) },
      ]
    : [
        // Shared with me: copying links into a Collection of my own - only once the content is open
        // (a share password first) and there is something to copy. 새 링크 알림 is the header's bell.
        ...(isContentLocked || items.length === 0
          ? []
          : [{ label: t('collections.copyToMine'), icon: CopyIcon, onPress: closeCollectionMenuThen(() => linkSelection.begin()) }]),
        // Their own personal lock (their lock password; the Owner and the other members are not affected): a confirmation to set it,
        // the password to remove it.
        collection.isMemberLocked
          ? { label: t('collections.lockRemoveAction'), icon: UnlockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('remove')) }
          : { label: t('collections.lockSetTitle'), icon: LockIcon, onPress: closeCollectionMenuThen(() => setLockDialogMode('lock')) },
        // An active member can always leave on their own (the Owner cannot - they delete instead).
        { label: t('collections.leaveAction'), destructive: true, icon: LogoutIcon, onPress: closeCollectionMenuThen(() => setIsLeaveConfirmVisible(true)) },
      ];

  // Not while the content is behind a lock; a search shows its number only once every result page has arrived (never a partial count).
  const linkCount = isContentLocked ? null
    : search.isSearching ? (search.hasMore || search.isLoading ? null : search.items.length)
      : collection.itemCount;

  const toolbar = (
    <View style={styles.navigationBar}>
      {backButton}
      <View style={styles.headerActions} testID="collection-details-toolbar">
        {/* The caller's own favorite mark - a Contributor has one too; it changes
            nothing for anyone else, so it is not an Owner-only control. */}
        <Pressable accessibilityLabel={collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite')} accessibilityRole="button" accessibilityState={{ disabled: isTogglingFavorite, busy: isTogglingFavorite }} onPress={() => { if (isTogglingFavorite) return; bumpStar(); toggleFavoriteAction().catch(() => undefined); }} style={styles.toolbarButton} testID="collection-details-favorite">
          <FavoriteStar active={collection.isFavorite} playToken={starTap} size={20} />
        </Pressable>
        {/* 새 링크 알림 - a plain on/off toggle of the caller's own preference, shown once it is known. */}
        {offersNewLinkNotifications && newLinkNotifications !== null ? (
          <Pressable
            accessibilityLabel={t(newLinkNotifications ? 'collections.newLinkNotificationsOnA11y' : 'collections.newLinkNotificationsOffA11y')}
            accessibilityRole="button"
            onPress={() => changeNewLinkNotifications(!newLinkNotifications)}
            style={styles.toolbarButton}
            testID="collection-details-notifications"
          >
            {/* The shape alone tells the state: a bell when on, a slashed bell when off - no badge. */}
            {newLinkNotifications
              ? <BellIcon color={colors.textPrimary} size={20} />
              : <BellOffIcon color={colors.textSecondary} size={20} />}
          </Pressable>
        ) : null}
        {isOwner ? (
          // The single entry point for sharing - opens the one Share screen; tapping it never
          // turns anything on by itself.
          <Pressable
            accessibilityLabel={t('collections.shareAction')}
            accessibilityRole="button"
            onPress={openOwnerShare}
            style={styles.toolbarButton}
            testID="collection-details-share"
          >
            <ShareIcon color={colors.textPrimary} size={20} />
          </Pressable>
        ) : memberShareUrl ? (
          // A member passes on the Owner's public link: 친구 / ID / 외부 공유, after the server
          // confirms it is still public. Nothing about the link's settings (or its password) is
          // reachable here, and nobody is invited.
          <Pressable
            accessibilityLabel={t('collections.sharePublicLinkA11y')}
            accessibilityRole="button"
            accessibilityState={{ busy: isCheckingShareLink }}
            disabled={isCheckingShareLink}
            onPress={() => {
              openMemberLinkShare().catch(() => undefined);
            }}
            style={styles.toolbarButton}
            testID="collection-details-share-link"
          >
            <ShareIcon color={colors.textPrimary} size={20} />
          </Pressable>
        ) : null}
        {collectionMenuActions.length > 0 ? (
          <Pressable
            accessibilityLabel={t('collections.manageAction')}
            accessibilityRole="button"
            accessibilityState={{ disabled: isDeletingCollection, busy: isDeletingCollection }}
            disabled={isDeletingCollection}
            onPress={() => setIsCollectionMenuVisible(true)}
            style={[styles.toolbarButton, isDeletingCollection && styles.disabledButton]}
            testID="collection-details-more"
          >
            <MoreIcon color={colors.textSecondary} size={20} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
  const pendingSubmissions = collection.pendingSubmissionCount ?? 0;
  const pendingJoins = collection.pendingJoinRequestCount ?? 0;
  const reviewRequestCount = pendingSubmissions + pendingJoins;
  const reviewTitle = t('collections.reviewRequests');
  const reviewStatus = t('collections.myPendingStatus', { count: reviewRequestCount });
  const participantCount = participants?.participants.length ?? otherParticipants + 1;
  // Scrolls away with the links: the big detail header (title, participants, review requests).
  const collapsibleDetails = (
    <View style={styles.collapsibleTop}>
      <CollectionHeaderTitle
        key={collection.id}
        collectionId={collection.id}
        color={collection.color}
        icon={collection.icon}
        imageUrl={collection.iconImageUrl}
        imageVersion={collection.iconImageVersion}
        isLocked={isCollectionLocked(collection)}
        name={collection.name}
      />
      {showParticipantStack ? (
        <ParticipantAvatarStack
          accessibilityHint={t('collections.participantsTitle')}
          accessibilityLabel={t('collections.participantsAvatarsA11y', { count: participantCount })}
          maxAvatars={5}
          onPress={() => setIsParticipantsSheetVisible(true)}
          participants={stackParticipants}
          placeholderCount={Math.min(otherParticipants + 1, 5)}
          style={styles.participantStack}
          testID="collection-details-participants"
          trailing={
            <View style={styles.participantSummary}>
              <Text style={styles.participantCount}>{t('collections.participantsCount', { count: participantCount })}</Text>
              <ChevronIcon color={colors.textSecondary} direction={direction === 'rtl' ? 'left' : 'right'} size={16} />
            </View>
          }
        />
      ) : null}
      {isOwner && reviewRequestCount > 0 ? (
        <PendingActionRow
          accessibilityLabel={`${reviewTitle}, ${reviewStatus}`}
          compact
          count={reviewRequestCount}
          label={reviewTitle}
          onPress={() => runUnlocked(() => {
            setOwnerRequestSheet('review');
            loadCollection().catch(() => undefined);
          })}
          style={styles.reviewRequests}
          testID="collection-details-review-requests"
        />
      ) : null}
    </View>
  );
  // Stays at the top: the link search and the count / view switch.
  const pinnedControls = (
    <View style={styles.pinnedControls}>
      {/* 링크 검색 right under the actions - the server-backed search of this Collection. */}
      {isContentLocked ? null : (
        <View style={styles.searchBox}>
          <SearchField
            accessibilityHint={t('history.searchMinHint')}
            clearLabel={t('history.searchClear')}
            onChangeText={setSearchText}
            placeholder={t('history.searchPlaceholder')}
            testID="collection-search"
            value={searchText}
          />
          {searchText.trim().length === 1 ? <Text style={styles.searchHint}>{t('history.searchMinHint')}</Text> : null}
        </View>
      )}
      {/* The content row: how many links are shown (the Collection's, or the search's once its results are complete) on the start side,
          List / Grid / Image at the end edge - links are always newest first, so there is no order to pick. */}
      <View style={styles.sortRow} testID="collection-view-controls">
        {linkCount !== null ? (
          <View style={styles.linkCountCluster}>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.linkCountIcon}>
              <LinkIcon color={colors.textSecondary} size={18} />
            </View>
            <Text numberOfLines={1} style={styles.linkCount} testID="collection-link-count">{t('collections.linkCount', { count: linkCount })}</Text>
          </View>
        ) : null}
        <View style={styles.sortRowSpacer} />
        <ViewModeToggle onChange={changeViewMode} showImage tinted style={styles.viewModeToggle} value={viewMode} />
      </View>
    </View>
  );
  // Scrolls with the links: the submitter's pending row and load failures.
  const listHeader = (
    <View>
      {/* A submitter's 내 승인 대기: MY OWN proposed links that the Owner has not answered yet - a long
          action row of the same family as the Owner's 승인 대기 (same size, shape and shadow, neutral
          color), directly under the sort / List-Grid controls and right before the first link. Separate
          from the Owner's row: a different number for a different person, never merged. */}
      {(collection.myPendingSubmissionCount ?? 0) > 0 ? (
        <PendingActionRow
          accessibilityLabel={t('collections.myPendingSubmissionsA11y', { count: collection.myPendingSubmissionCount })}
          statusText={t('collections.myPendingStatus', { count: collection.myPendingSubmissionCount })}
          variant="status"
          label={t('collections.myPendingSubmissions')}
          onPress={() => setIsMyApprovalSheetVisible(true)}
          style={styles.myPendingRowSpacing}
          testID="collection-details-my-pending"
        />
      ) : null}
      {/* A failed LOAD (the Collection's refresh, or its links) is a centered state with a retry; the result of an action
          (favorite, remove, share) is the common message dialog below - never an inline red line. */}
      {collectionError ? <LoadFailureState compact error={collectionError.cause} notice={collectionError.notice} onRetry={() => { loadCollection().catch(() => undefined); }} testID="collection-details-refresh-error" /> : null}
      {error ? <LoadFailureState compact onRetry={() => { refresh(); }} testID="collection-details-items-error" /> : null}
    </View>
  );

  // Nothing to show yet: where the links are about to appear - skeletons only while that request is actually on its way.
  const listEmpty = isContentLocked ? (
    <CollectionUnlockPanel collectionId={collectionId} isOwner={isOwner || (collection.isMemberLocked === true && contentLockKind === 'lock')} kind={contentLockKind ?? 'lock'} onUnlocked={refresh} />
  ) : isLoading ? (
    <View testID="collection-items-loading">
      {Array.from({ length: FIRST_PAGE_SKELETON_ROWS }, (_, index) => (
        <View key={index} style={[savedLinkLayout.card, styles.skeletonRow]}>
          <SavedLinkRowSkeleton testID="collection-items-skeleton" />
        </View>
      ))}
    </View>
  ) : !error ? <CenteredEmptyState message={t('collections.itemsEmpty')} /> : undefined;

  // The next page of the Collection's links, as the end of the list comes near (never while locked or already loading).
  const loadNextPage = () => {
    if (!isContentLocked && paged.hasMore && !paged.isLoadingMore && !isLoading && !error) {
      paged.loadMore();
    }
  };
  const pageFooter = paged.isLoadingMore ? <ActivityIndicator style={styles.searchStatus} testID="collection-items-loading-more" /> : undefined;

  const renderFlatRow = ({ item: row }: { item: CollectionFlatRow }) => {
    switch (row.kind) {
      case 'flatItem':
        return renderCollectionItem(row.item);
      case 'flatGridRow':
        return (
          <View style={styles.flatGridRow} testID={`collection-flat-grid-row-${row.key}`}>
            {row.items.map((item, column) => <Fragment key={item.itemId}>{renderCollectionItem(item, undefined, column)}</Fragment>)}
            {Array.from({ length: columns.grid - row.items.length }, (_, index) => <View key={`filler-${index}`} style={gridCellStyle} />)}
          </View>
        );
      case 'flatImageRow':
        return <SavedLinkImageRow items={row.items.map(toSavedLinkRowItem)} onLongPress={startImageSelection} onPress={openImageTile} selection={linkSelection.imageSelection} swipeActions={imageSwipeActions} swipeDisabled={itemActionInFlightId !== null || isRefreshing} testID={`collection-flat-image-row-${row.key}`} />;
    }
  };

  return (
    <TabScreenSafeArea style={[styles.safeArea, { backgroundColor: pageBackground }]} testID="collection-details-screen">
      {/* While selecting, the selection header (close, count, 전체 선택) takes the toolbar's place, as in a gallery. */}
      {linkSelection.topBar ?? toolbar}
      {/* Only the password prompt of a locked Collection takes text here - it must stay above the keyboard. */}
      <KeyboardSafeView enabled={isContentLocked}>
      <CollapsibleHeaderLayout
        backgroundColor={pageBackground}
        collapsible={collapsibleDetails}
        pinned={pinnedControls}
        resetKey={`${search.isSearching && !isContentLocked ? 'search' : 'items'}-${layoutMode}`}
        testID="collection-details-fixed-header"
      >
        {list => (
          <>
          {search.isSearching && !isContentLocked ? (
            <AnimatedFlatList
              ref={list.listRef}
              onScroll={list.onScroll}
              scrollEventThrottle={list.scrollEventThrottle}
              key="collection-search"
              extraData={linkSelection.selection}
              contentContainerStyle={[styles.content, list.contentInset(searchRows.length > 0)]}
              style={styles.list}
              data={searchRows}
              keyExtractor={row => row.key}
              keyboardShouldPersistTaps="handled"
              refreshControl={list.withRefreshOffset(pullToRefresh.refreshControl)}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={search.isLoading ? (
                <ActivityIndicator style={styles.searchStatus} testID="collection-search-loading" />
              ) : search.error ? (
                <LoadFailureState error={search.error} onRetry={search.refresh} testID="collection-search-error" />
              ) : search.settledTerm !== null ? (
                <CenteredEmptyState message={t('history.searchEmpty')} />
              ) : undefined}
              ListFooterComponent={search.items.length > 0 && search.error ? (
                <RefreshFailureNotice onRetry={search.loadMore} testID="collection-search-more-error" />
              ) : search.isLoadingMore ? <ActivityIndicator style={styles.searchStatus} /> : undefined}
              onContentSizeChange={viewportFill.onContentSizeChange}
              onEndReached={search.loadMore}
              onEndReachedThreshold={END_REACHED_THRESHOLD}
              onLayout={viewportFill.onLayout}
              onScrollBeginDrag={closeOpenRow}
              scrollEnabled={swipeScrollEnabled}
              renderItem={renderFlatRow}
            />
          ) : layoutMode === 'image' ? (
            // Image: the loaded links three tiles to a line, the next page as the end comes near.
            <AnimatedFlatList
              ref={list.listRef}
              onScroll={list.onScroll}
              scrollEventThrottle={list.scrollEventThrottle}
              key="image-list"
              extraData={linkSelection.selection}
              contentContainerStyle={[styles.content, list.contentInset(!isContentLocked && imageRows.length > 0)]}
              style={styles.list}
              data={isContentLocked ? [] : imageRows}
              keyExtractor={row => row.key}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              refreshControl={list.withRefreshOffset(pullToRefresh.refreshControl)}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={listEmpty}
              ListFooterComponent={pageFooter}
              onEndReached={loadNextPage}
              onEndReachedThreshold={END_REACHED_THRESHOLD}
              onScrollBeginDrag={closeOpenRow}
              scrollEnabled={swipeScrollEnabled}
              renderItem={renderFlatRow}
            />
          ) : (
            <AnimatedFlatList
              ref={list.listRef}
              onScroll={list.onScroll}
              scrollEventThrottle={list.scrollEventThrottle}
              key={gridListKey(layoutMode, layoutMode === 'grid', columns.grid)}
              extraData={linkSelection.selection}
              contentContainerStyle={[styles.content, list.contentInset(!isContentLocked && items.length > 0)]}
              style={styles.list}
              data={isContentLocked ? [] : items}
              keyExtractor={(item: CollectionItemEntry) => item.itemId.toString()}
              numColumns={layoutMode === 'grid' ? columns.grid : 1}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              removeClippedSubviews={Platform.OS === 'android'}
              refreshControl={list.withRefreshOffset(pullToRefresh.refreshControl)}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={listEmpty}
              ListFooterComponent={pageFooter}
              onEndReached={loadNextPage}
              onEndReachedThreshold={END_REACHED_THRESHOLD}
              onScrollBeginDrag={closeOpenRow}
              scrollEnabled={swipeScrollEnabled}
              renderItem={({ item, index }) => renderCollectionItem(item, undefined, layoutMode === 'grid' ? index % columns.grid : undefined)}
            />
          )}
          </>
        )}
      </CollapsibleHeaderLayout>
      </KeyboardSafeView>
      {linkSelection.element}
      <CategoryEditorDialog
        error={editError}
        initialColor={resolveEffectiveCollectionColorValue(collection.color, collection.id)}
        initialIcon={resolveCollectionIconKey(collection.icon)}
        initialImageUrl={collection.iconImageUrl ?? null}
        initialName={collection.name}
        isSubmitting={isSavingEdit}
        mode="edit"
        onCancel={cancelEditName}
        onSubmit={submitEdit}
        visible={isEditDialogVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('collections.deleteConfirmMessage')}
        onCancel={() => setIsDeleteConfirmVisible(false)}
        onConfirm={() => {
          setIsDeleteConfirmVisible(false);
          deleteCollectionAction();
        }}
        title={t('collections.deleteConfirmTitle')}
        visible={isDeleteConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.leaveConfirmButton')}
        message={t('collections.leaveConfirmMessage')}
        onCancel={() => setIsLeaveConfirmVisible(false)}
        onConfirm={() => {
          setIsLeaveConfirmVisible(false);
          leaveCollectionAction();
        }}
        title={t('collections.leaveConfirmTitle')}
        visible={isLeaveConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.unlinkAction')}
        message={t('collections.unlinkConfirmMessage')}
        onCancel={() => setPendingUnlinkItemId(null)}
        onConfirm={() => {
          const itemId = pendingUnlinkItemId;
          setPendingUnlinkItemId(null);
          if (itemId !== null) {
            removeItemAction(itemId);
          }
        }}
        title={t('collections.unlinkConfirmTitle')}
        visible={pendingUnlinkItemId !== null}
      />
      <ActionMenuDialog
        actions={collectionMenuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setIsCollectionMenuVisible(false)}
        visible={isCollectionMenuVisible}
      />
      <CollectionLockDialog
        collectionId={collectionId}
        forMember={!isOwner}
        mode={lockDialogMode ?? 'lock'}
        onCancel={() => setLockDialogMode(null)}
        onChanged={() => {
          setLockDialogMode(null);
          loadCollection();
          refresh();
        }}
        onOpenSettings={() => {
          setLockDialogMode(null);
          navigation.navigate('CollectionLockSettings');
        }}
        visible={lockDialogMode !== null}
      />
      {pendingUnlockAction !== null ? (
        <CollectionUnlockModal
          collectionId={collectionId}
          collectionName={collection.name}
          isOwner={isOwner || (collection.isMemberLocked === true && contentLockKind === 'lock')}
          onCancel={() => setPendingUnlockAction(null)}
          onUnlocked={() => {
            const action = pendingUnlockAction;
            setPendingUnlockAction(null);
            refresh();
            action?.();
          }}
          testID="collection-details-unlock-gate"
          visible
        />
      ) : null}
      <ReactionPickerDialog
        myReaction={reactionPickerItem ? itemReactions.reactionsOf(reactionPickerItem.itemId, reactionPickerItem).myReaction : null}
        onClose={() => setReactionPickerItem(null)}
        onSelect={key => {
          const item = reactionPickerItem;
          setReactionPickerItem(null);
          if (item) {
            reactToItem(item, key);
          }
        }}
        recent={recentReactions}
        visible={reactionPickerItem !== null}
      />
      <CollectionLinkShareSheet
        authenticatedRequest={authenticatedRequest}
        collectionId={collectionId}
        onClose={() => setIsLinkShareSheetVisible(false)}
        onLinkInactive={() => {
          setIsLinkShareSheetVisible(false);
          setMemberShareUrl(null);
          showNotificationToast(t('collections.publicShareEnded'));
        }}
        onSent={count => {
          setIsLinkShareSheetVisible(false);
          showNotificationToast(t('linkShare.sent', { count }));
        }}
        onShareExternally={() => {
          shareLinkExternally().catch(() => undefined);
        }}
        visible={isLinkShareSheetVisible && !isOwner}
      />
      {/* 검토할 요청: ONE sheet - the type chooser and the 링크 승인 / 참여 요청 lists slide inside it (a notification may open straight on a list). */}
      <CollectionReviewRequestsSheet
        approvalCount={pendingSubmissions}
        authenticatedRequest={authenticatedRequest}
        collectionId={collectionId}
        initialPage={ownerRequestSheet === 'approvals' ? 'approvals' : ownerRequestSheet === 'join' ? 'join' : 'types'}
        joinCount={pendingJoins}
        onBeforeOpenList={runUnlocked}
        onChanged={refreshAll}
        onClose={() => setOwnerRequestSheet(null)}
        visible={ownerRequestSheet !== null && isOwner && pendingUnlockAction === null}
      />
      <ApprovalSubmissionSheet
        authenticatedRequest={authenticatedRequest}
        collectionId={collectionId}
        expectedCount={collection.myPendingSubmissionCount ?? 0}
        onChanged={() => {
          // One of my proposals was cancelled: this Collection's own pending count follows.
          loadCollection().catch(() => undefined);
        }}
        onClose={() => setIsMyApprovalSheetVisible(false)}
        onTotalLoaded={total => {
          if (total !== (collection.myPendingSubmissionCount ?? 0)) {
            loadCollection().catch(() => undefined);
          }
        }}
        variant="mine"
        visible={isMyApprovalSheetVisible && pendingUnlockAction === null}
      />
      <CollectionParticipantsSheet
        authenticatedRequest={authenticatedRequest}
        collectionId={collectionId}
        initialData={participants}
        onClose={() => setIsParticipantsSheetVisible(false)}
        // Stepped aside while the password prompt is up (one modal at a time on iOS); it returns
        // after the unlock - with the resumed action running - or after a cancel.
        visible={isParticipantsSheetVisible && pendingUnlockAction === null}
      />
      {notice ? <ConfirmDialog confirmLabel={t('common.confirm')} message={notice} onConfirm={() => setNotice(null)} title={t('common.notice')} visible /> : null}
    </TabScreenSafeArea>
  );
}

const ICON_BUTTON_SIZE = 36;

const styles = themedStyles(() => ({
  sharedByRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  sharedByText: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 13,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  // flex:1 above the tab bar - the list viewport itself ends above it (and the tab bar above the
  // system nav bar), for List and Grid alike.
  list: {
    flex: 1,
  },
  // Same side gutter as the list's content; no background of its own (the page background shows through, one colour).
  collapsibleTop: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  pinnedControls: { paddingHorizontal: spacing.md },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    flexGrow: 1,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  navigationBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  participantStack: { alignSelf: 'stretch', marginBottom: spacing.sm, marginTop: 0 },
  participantSummary: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.xs, marginStart: spacing.md, minWidth: 0 },
  reviewRequests: { marginBottom: spacing.md },
  participantCount: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '600' },
  // The controls row above already carries the gap; this one the gap to the first link.
  myPendingRowSpacing: { marginBottom: LINK_CONTROLS_BOTTOM_GAP },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
  },
  toolbarButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  // Icon-only, no border box (see this round's "버튼마다 큰 border box를 만들지 말 것") - the
  // Pressable itself is the full min touch target even though the icon drawn inside it is
  // visually compact (size=20), so the tappable area never shrinks below 44x44dp.
  // 36dp control (so the press shows only around the icon) + the 4dp hitSlop on each Pressable = the 44dp touch target.
  iconButton: {
    alignItems: 'center',
    height: ICON_BUTTON_SIZE,
    justifyContent: 'center',
    width: ICON_BUTTON_SIZE,
  },
  error: {
    color: colors.dangerText,
    fontSize: 14,
    marginTop: 12,
  },
  skeletonRow: { overflow: 'hidden' },
  // Wraps only when the sort chips and the three-option view switch genuinely do not fit side by side (the switch keeps the end edge).
  sortRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  // [chain icon 18dp] 6dp [링크 n개]: one line, the text ellipsizes before the end-edge switch moves.
  linkCountCluster: { alignItems: 'center', columnGap: 6, flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  linkCountIcon: { flexShrink: 0 },
  linkCount: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, fontWeight: '600' },
  viewModeToggle: { marginStart: 'auto' },
  flatGridRow: { flexDirection: 'row' },
  imageSectionLast: { paddingBottom: spacing.xs },
  searchBox: { marginBottom: spacing.sm },
  searchHint: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  searchStatus: { marginTop: spacing.xl },
  sortRowSpacer: { flex: 1 },
  disabledButton: {
    opacity: 0.5,
  },
}));
