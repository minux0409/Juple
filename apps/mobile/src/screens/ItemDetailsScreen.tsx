import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../api/ApiError';
import { linkProposalErrorMessage } from '../collections/linkProposals';
import { formatSaveOutcomeMessage } from '../collections/saveOutcomeMessage';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  addItemToCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
  getSharedCollectionItem,
  type SharedCollectionItem,
} from '../collections/api/collectionsApi';
import { getCollectionUnlockToken } from '../collections/collectionUnlockGrants';
import { useItemCollaboration } from '../collaboration/useItemCollaboration';
import { CategoryField } from '../collections/CategoryField';
import { CategoryPickerModal } from '../collections/CategoryPickerModal';
import { useCategoryPickerModal } from '../collections/useCategoryPickerModal';
import { contentGateOfError } from '../collections/useCollectionItems';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useAppToast } from '../components/AppToast';
import { useMessageDialog } from '../components/useMessageDialog';
import { useToastBottomAnchor } from '../components/useToastBottomAnchor';
import { ContentPreviewCard } from '../components/ContentPreviewCard';
import { SourceRow } from '../components/SourceRow';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import {
  deleteItemImage,
  getItemImages,
  uploadItemImage,
  type ItemImage,
} from '../images/api/imagesApi';
import { RepresentativePhotoField } from '../images/RepresentativePhotoField';
import { representativePhotoUrl, resolveRepresentativePhoto } from '../items/representativePhoto';
import {
  deleteItem,
  getItemDetails,
  updateItemDetails,
  type ItemDetails,
} from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetails'>;

function getLoadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorLoadFallback');
}

function getSaveErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('errors.invalidInput');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('item.errorSaveFallback');
}

function getItemCollectionsListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorListFallback');
}

function getCollectionMembershipErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return linkProposalErrorMessage(error, t) ?? t('collections.errorMembershipFallback');
}

function getImageListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorImageListFallback');
}

/** Never surfaces raw server/credential/token detail - only a short, actionable localized message. */
function getImageUploadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return t('item.errorImageUploadInvalid');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    if (error.kind === 'timeout' || error.kind === 'unavailable') {
      return t('item.errorImageUploadNetwork');
    }
  }
  return t('item.errorImageUploadFallback');
}

function getImageDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorImageDeleteFallback');
}

function getItemDeleteErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorItemDeleteFallback');
}

/** picker/permission failures never reach the server, so this maps react-native-image-picker's own errorCode only. */
function getImagePickerErrorMessage(errorCode: string | undefined, t: TFunction): string {
  if (errorCode === 'permission') {
    return t('item.errorImagePickerPermission');
  }
  return t('item.errorImagePickerFallback');
}

export function ItemDetailsScreen({ route, navigation }: Props) {
  const { t } = useTranslation();
  const { showNotificationToast } = useAppToast();
  const { itemId, collectionContext, initialFocus } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();
  // The fixed bottom action bar's height isn't a fixed constant (button text can wrap under long
  // translations/font scaling), so it's measured via onLayout (see the bottomBar View below)
  // rather than guessed - a Toast's bottomOffset needs this exact value to sit above the bar
  // instead of overlapping it.
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  // The Collection's reactions and comments on this link - only when it was opened from a Collection that
  // has other people in it, and only IN that Collection. The server's view of the link in that Collection
  // (its counts and my reaction) is read once; the collaboration is its own state from then on, so reacting
  // or commenting never reloads this screen or touches a draft.
  const collaborationCollectionId = collectionContext?.collectionId ?? null;
  const isCollaborative = collectionContext?.isCollaborative === true && collaborationCollectionId !== null;
  const [collaborationRow, setCollaborationRow] = useState<SharedCollectionItem | null>(null);
  useEffect(() => {
    if (!isCollaborative || collaborationCollectionId === null) {
      return undefined;
    }
    let isActive = true;
    getSharedCollectionItem(authenticatedRequest, collaborationCollectionId, itemId, getCollectionUnlockToken(collaborationCollectionId))
      .then(row => {
        if (isActive) {
          setCollaborationRow(row);
        }
      })
      // Locked, no longer there, or offline: no collaboration section (the item itself is unaffected).
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [authenticatedRequest, collaborationCollectionId, isCollaborative, itemId]);
  const collaboration = useItemCollaboration({
    collectionId: collaborationCollectionId ?? 0,
    itemId,
    isCollectionOwner: collectionContext?.isCollectionOwner === true,
    row: collaborationRow,
    enabled: isCollaborative && collaborationRow !== null,
  });
  // What a save, photo change, delete or open just did when it was not a plain success (or a save that
  // proposed the link to 승인 후 추가 Collections) - the shared message dialog, never a red line that
  // can be missed or hidden under the keyboard. Drafts are never touched by it.
  const { showMessage, messageDialog } = useMessageDialog();
  useToastBottomAnchor(bottomBarHeight);

  // Opened from a comment notification: the comments are brought into view once - after they are
  // actually laid out (their position is measured, never guessed), so the screen never jumps early.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const commentsYRef = useRef<number | null>(null);
  const scrollToCommentsPending = useRef(initialFocus === 'comments');
  const scrollToCommentsIfPending = useCallback(() => {
    if (!scrollToCommentsPending.current || commentsYRef.current === null) {
      return;
    }
    scrollToCommentsPending.current = false;
    const y = Math.max(0, commentsYRef.current - spacing.md);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: true, y }));
  }, []);

  const [item, setItem] = useState<ItemDetails | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [baselineTitle, setBaselineTitle] = useState('');
  const [baselineMemo, setBaselineMemo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The photo (대표 사진) is an immediate server mutation, deliberately never staged - unlike
  // title/memo/categories, there is no locally-staged photo state for Save to ever commit (see this
  // file's isDirty below). A photo change updates only this photo state from the server's answer:
  // it never reloads the Item, so a memo or Collection choice not yet saved is never lost.
  const [images, setImages] = useState<readonly ItemImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  // One photo change (add/change/remove) at a time; it busies only the photo field.
  const [isPhotoBusy, setIsPhotoBusy] = useState(false);
  const isPhotoBusyRef = useRef(false);
  const [imagesError, setImagesError] = useState<string | null>(null);

  // The Item's currently-staged Collection membership (selectedCategories) vs. the last known
  // persisted membership (originalCategoryIds) - the diff between the two is exactly what Save
  // must add/remove. There is no cap on how many Collections an Item can belong to, so
  // loadItemCollections below drains every page itself rather than assuming one page is enough.
  const [selectedCategories, setSelectedCategories] = useState<readonly Collection[]>([]);
  const [originalCategoryIds, setOriginalCategoryIds] = useState<ReadonlySet<number>>(new Set());
  const [isLoadingItemCollections, setIsLoadingItemCollections] = useState(true);
  const [itemCollectionsError, setItemCollectionsError] = useState<string | null>(null);
  const itemCollectionsRequestIdRef = useRef(0);

  const isSavingRef = useRef(isSaving);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const [isItemActionInFlight, setIsItemActionInFlight] = useState(false);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [isRemoveFromCollectionConfirmVisible, setIsRemoveFromCollectionConfirmVisible] = useState(false);
  // Flips true only once the Delete API call has actually succeeded - never before (see
  // deleteItemAction: dirty state itself is never cleared/reset by Delete). Gates both the
  // unsaved-changes guard below and Save, and drives the goBack() effect further down - see that
  // effect's own remarks for why the navigation call itself must live there and not inline in
  // deleteItemAction.
  const [isDeleted, setIsDeleted] = useState(false);
  const [isUnsavedChangesDialogVisible, setIsUnsavedChangesDialogVisible] = useState(false);
  // Stashes a closure over usePreventRemove's imperative `data.action`, rather than the action
  // value itself, so this ref never needs to describe that action's shape.
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const itemActionInFlightRef = useRef(false);

  // Plain per-render value (not memoized - a cheap scan over a small list), so the focus-refetch
  // guard below and the combined isDirty further down always agree on one definition. Image
  // add/remove is deliberately excluded - see the "images" state's own comment above.
  const isCategoriesDirty =
    selectedCategories.length !== originalCategoryIds.size ||
    selectedCategories.some(option => !originalCategoryIds.has(option.id));
  const isDirty = title !== baselineTitle || memo !== baselineMemo || isCategoriesDirty;

  const isCategoriesDirtyRef = useRef(isCategoriesDirty);
  useEffect(() => {
    isCategoriesDirtyRef.current = isCategoriesDirty;
  }, [isCategoriesDirty]);

  const selectedCategoryIds = new Set(selectedCategories.map(option => option.id));

  // The one 대표 사진: the user's own photo, else the link's automatic preview (see representativePhoto.ts).
  const representativePhoto = resolveRepresentativePhoto(item?.previewImageUrl ?? null, images, item?.coverImage?.id ?? null);

  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const details = await getItemDetails(authenticatedRequest, itemId);
      setItem(details);
      setTitle(details.title ?? '');
      setMemo(details.memo ?? '');
      setBaselineTitle(details.title ?? '');
      setBaselineMemo(details.memo ?? '');
    } catch (caughtError) {
      setError(getLoadErrorMessage(caughtError, t));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, itemId, t]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const loadImages = useCallback(async () => {
    setIsLoadingImages(true);
    setImagesError(null);
    try {
      const fetchedImages = await getItemImages(authenticatedRequest, itemId);
      setImages(fetchedImages);
    } catch (caughtError) {
      setImagesError(getImageListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingImages(false);
    }
  }, [authenticatedRequest, itemId, t]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  // Drains every page itself (there is no cap on how many Collections an Item can belong to - "100
  // is enough" was a false assumption) rather than exposing a manual "load more" - the compact
  // category summary (see categorySummaryRow below) needs the complete, accurate selected set to
  // show a correct "+N" count and can't leave the Detail screen's own height depend on how many
  // pages loaded, which is exactly what this redesign moved away from.
  const loadItemCollections = useCallback(async () => {
    const requestId = ++itemCollectionsRequestIdRef.current;
    setIsLoadingItemCollections(true);
    setItemCollectionsError(null);
    try {
      let cursor: string | null = null;
      let allItems: Collection[] = [];
      do {
        // scope 'all': the Item's own Collections AND the ones shared with me it was added to - the
        // default (owned) scope silently left the shared ones out of this screen, so the summary
        // disagreed with the Collections themselves and a save could never remove the Item there.
        const page = await getCollections(authenticatedRequest, {
          itemId,
          scope: 'all',
          limit: COLLECTION_OPTIONS_PAGE_LIMIT,
          cursor: cursor ?? undefined,
        });
        if (itemCollectionsRequestIdRef.current !== requestId) {
          return;
        }
        allItems = allItems.concat(page.items);
        cursor = page.nextCursor;
      } while (cursor);
      setSelectedCategories(allItems);
      setOriginalCategoryIds(new Set(allItems.map(option => option.id)));
    } catch (caughtError) {
      if (itemCollectionsRequestIdRef.current !== requestId) {
        return;
      }
      setItemCollectionsError(getItemCollectionsListErrorMessage(caughtError, t));
    } finally {
      if (itemCollectionsRequestIdRef.current === requestId) {
        setIsLoadingItemCollections(false);
      }
    }
  }, [authenticatedRequest, itemId, t]);

  // Refetches on every focus (not just mount), so a Collection add/remove made elsewhere (e.g. from
  // CollectionDetailsScreen) is reflected here too - but never while the user has an in-progress,
  // unsaved staged category edit on this very screen, which a refetch would otherwise silently
  // discard the moment focus returns here (e.g. after opening the add-to-category modal's "create
  // new category" flow, which itself briefly leaves and returns focus in some navigators).
  useFocusEffect(
    useCallback(() => {
      if (!isCategoriesDirtyRef.current) {
        loadItemCollections();
      }
    }, [loadItemCollections]),
  );

  /** Starts a photo change; false when another one is still running. Always paired with endPhotoChange. */
  const beginPhotoChange = () => {
    if (isPhotoBusyRef.current) {
      return false;
    }
    isPhotoBusyRef.current = true;
    setIsPhotoBusy(true);
    setImagesError(null);
    return true;
  };

  const endPhotoChange = () => {
    isPhotoBusyRef.current = false;
    setIsPhotoBusy(false);
  };

  /**
   * 사진 추가 / 사진 변경: the picked photo becomes the Item's one photo - the server stores it,
   * replaces any previous one and makes it the cover, all at once (a failure leaves the previous
   * one). Only the photo state is updated from the answer: no reload of the Item.
   */
  const pickAndUploadImage = async () => {
    if (isPhotoBusyRef.current) {
      return;
    }

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: false,
      // Converts HEIC/HEIF to a JPEG-compatible representation on supported platforms rather
      // than passing through the device's native format, which the server would reject.
      assetRepresentationMode: 'compatible',
    });

    // A cancelled pick changes nothing and is not an error.
    if (result.didCancel) {
      return;
    }

    const asset = result.assets?.[0];
    if (result.errorCode || !asset?.uri) {
      showMessage(getImagePickerErrorMessage(result.errorCode, t));
      return;
    }

    if (!beginPhotoChange()) {
      return;
    }
    try {
      // asset.type is whatever the picker actually reports post-conversion - never assumed or
      // overridden to 'image/jpeg' here. The server independently verifies the real format via
      // magic bytes regardless of what this claims.
      const uploaded = await uploadItemImage(authenticatedRequest, itemId, {
        uri: asset.uri,
        type: asset.type,
        fileName: asset.fileName,
      });
      // The server answer is the whole truth about the photo now: this one, as the cover. Its
      // read URL is new (a new Blob per upload), so no cached image of the old one can show.
      setImages([uploaded]);
      setItem(previous =>
        previous
          ? { ...previous, coverImage: uploaded.readUrl !== null ? { id: uploaded.id, readUrl: uploaded.readUrl } : null }
          : previous,
      );
    } catch (caughtError) {
      // The previous photo (or none) stays exactly as it was; the reason is said in the message dialog.
      showMessage(getImageUploadErrorMessage(caughtError, t));
    } finally {
      endPhotoChange();
    }
  };

  /**
   * 사진 삭제 (already confirmed in the field): the Item is left with no photo of its own - the
   * server removes it (and any extra one from when two were allowed) and clears the cover. Only the
   * photo state changes; on failure the photo stays.
   */
  const removePhoto = async () => {
    if (representativePhoto?.kind !== 'uploaded' || !beginPhotoChange()) {
      return;
    }
    try {
      await deleteItemImage(authenticatedRequest, itemId, representativePhoto.image.id);
      setImages([]);
      setItem(previous => (previous ? { ...previous, coverImage: null } : previous));
    } catch (caughtError) {
      showMessage(getImageDeleteErrorMessage(caughtError, t));
    } finally {
      endPhotoChange();
    }
  };

  const stageRemoveCategory = (collectionId: number) => {
    setSelectedCategories(previous => previous.filter(option => option.id !== collectionId));
  };

  const stageAddCategory = (option: Collection) => {
    setSelectedCategories(previous =>
      previous.some(existing => existing.id === option.id) ? previous : [...previous, option],
    );
  };

  // Creating a category itself is not part of this Item's staged membership edit - it is an
  // immediate, item-independent action (like creating a folder to file into later); only actually
  // adding this Item to it is staged, via stageAddCategory. This round's CategoryPickerModal grid
  // rework auto-selects a freshly created category for the current Item uniformly across every
  // caller (see useCategoryPickerModal's own remarks) - previously ItemDetails deliberately did
  // not, but the "새로 만든 카테고리를 다시 찾아 누르게 하지 않는다" requirement now applies here too.
  const categoryPicker = useCategoryPickerModal(authenticatedRequest, t, stageAddCategory);

  const deleteItemAction = async () => {
    if (itemActionInFlightRef.current) {
      return;
    }

    itemActionInFlightRef.current = true;
    setIsItemActionInFlight(true);
    setIsDeletingItem(true);
    try {
      await deleteItem(authenticatedRequest, itemId);
      // Does NOT call navigation.goBack() directly here - see the isDeleted effect below for why
      // the actual navigation must wait for this state update to actually commit first.
      setIsDeleted(true);
    } catch (caughtError) {
      showMessage(getItemDeleteErrorMessage(caughtError, t));
    } finally {
      itemActionInFlightRef.current = false;
      setIsItemActionInFlight(false);
      setIsDeletingItem(false);
    }
  };

  const confirmDeleteItem = () => {
    if (itemActionInFlightRef.current) {
      return;
    }
    setIsDeleteConfirmVisible(true);
  };

  /**
   * Opened from inside a Collection, "delete" means "take it out of this Collection" - exactly the
   * Collection list's own swipe action: only that one membership goes, the saved link and its other
   * Collections stay. Only the Collection's Owner may do it (a server rule); anyone else is told so
   * instead of being offered a delete that would fail. A locked Collection uses this visit's grant.
   */
  const removeFromContextCollectionAction = async () => {
    if (!collectionContext || itemActionInFlightRef.current) {
      return;
    }
    const contextCollectionId = collectionContext.collectionId;
    itemActionInFlightRef.current = true;
    setIsItemActionInFlight(true);
    setIsDeletingItem(true);
    try {
      await removeItemFromCollection(authenticatedRequest, contextCollectionId, itemId);
      setSelectedCategories(previous => previous.filter(option => option.id !== contextCollectionId));
      setOriginalCategoryIds(previous => {
        const next = new Set(previous);
        next.delete(contextCollectionId);
        return next;
      });
      showNotificationToast(t('toast.unlinkSuccess'));
      // Back to the Collection, which reloads its list on focus. Unsaved title/memo edits still get
      // the usual "leave without saving?" question - the link itself was not deleted.
      navigation.goBack();
    } catch (caughtError) {
      showMessage(
        contentGateOfError(caughtError) === 'sharePassword'
          ? t('collections.sharePasswordRequiredForAction')
          : contentGateOfError(caughtError) === 'lock'
            ? t('collections.lockRequiredForAction')
            : getCollectionMembershipErrorMessage(caughtError, t),
      );
    } finally {
      itemActionInFlightRef.current = false;
      setIsItemActionInFlight(false);
      setIsDeletingItem(false);
    }
  };

  const onDeletePress = () => {
    if (!collectionContext) {
      confirmDeleteItem();
      return;
    }
    if (itemActionInFlightRef.current) {
      return;
    }
    if (!collectionContext.canRemove) {
      showNotificationToast(t('collections.removeFromSharedOwnerOnly'));
      return;
    }
    setIsRemoveFromCollectionConfirmVisible(true);
  };

  usePreventRemove(isDirty && !isDeleted, ({ data }) => {
    pendingLeaveRef.current = () => navigation.dispatch(data.action);
    setIsUnsavedChangesDialogVisible(true);
  });

  /**
   * Navigates back exactly once, only after a successful delete - deliberately not called inline
   * inside deleteItemAction. usePreventRemove's guard reads isDirty && !isDeleted through both an
   * insertion effect (into a shared cross-screen registry) and a layout-effect-updated ref (see
   * usePreventRemove.tsx/use-latest-callback), both of which only pick up isDeleted's new value
   * once this render actually commits. Calling navigation.goBack() synchronously right after
   * setIsDeleted(true) would still race the guard's stale (isDirty-true) closure and re-trigger the
   * unsaved-changes dialog - exactly the bug this fix exists for. Waiting for isDeleted here
   * guarantees the guard has already been disabled by the time this actually navigates.
   */
  useEffect(() => {
    if (isDeleted) {
      navigation.goBack();
    }
  }, [isDeleted, navigation]);

  /**
   * Persists exactly the staged changes - title/memo (if changed) and the category
   * add/remove diff - never a duplicate call for a category already in the state it's supposed to
   * reach. Each operation updates its own baseline (baselineTitle/baselineMemo, or
   * originalCategoryIds) the moment it succeeds, independently of whether any other operation in
   * this same Save later fails - so a partial category failure never loses or duplicates a still-
   * pending change, isDirty stays true only for what actually still needs saving, and the user can
   * just press Save again to retry the remainder. Images are never touched here - see the
   * "images" state's own comment above.
   */
  const save = async () => {
    if (isSavingRef.current || !isDirty || isDeleted) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const failureMessages: string[] = [];

    if (title !== baselineTitle || memo !== baselineMemo) {
      try {
        await updateItemDetails(authenticatedRequest, itemId, { title, memo });
        setBaselineTitle(title);
        setBaselineMemo(memo);
      } catch (caughtError) {
        failureMessages.push(getSaveErrorMessage(caughtError, t));
      }
    }

    const currentSelectedIds = new Set(selectedCategories.map(option => option.id));
    const categoriesToAdd = selectedCategories.filter(option => !originalCategoryIds.has(option.id));
    const categoryIdsToRemove = [...originalCategoryIds].filter(id => !currentSelectedIds.has(id));

    // 승인 후 추가: those became proposals for their Owners - not memberships, so they leave the
    // selection again (the link is not in those Collections until approved). A Collection that
    // already has this link, or already has it waiting for its Owner, is settled the same way: there
    // is nothing left to save for it, so it must not keep Save on (a retry could only fail again).
    const proposedIds = new Set<number>();
    const settledIds = new Set<number>();
    let addedCount = 0;
    for (const option of categoriesToAdd) {
      try {
        // Each locked Collection travels with the grant this screen's picker obtained for it.
        const outcome = await addItemToCollection(authenticatedRequest, option.id, itemId, { unlockToken: categoryPicker.unlockTokenFor(option.id) });
        if (outcome === 'submitted') {
          proposedIds.add(option.id);
        } else {
          addedCount += 1;
          setOriginalCategoryIds(previous => new Set(previous).add(option.id));
        }
      } catch (caughtError) {
        if (linkProposalErrorMessage(caughtError, t) !== null) {
          settledIds.add(option.id);
        }
        failureMessages.push(getCollectionMembershipErrorMessage(caughtError, t));
      }
    }
    if (proposedIds.size > 0 || settledIds.size > 0) {
      setSelectedCategories(previous => previous.filter(option => !proposedIds.has(option.id) && !settledIds.has(option.id)));
    }
    for (const collectionId of categoryIdsToRemove) {
      try {
        await removeItemFromCollection(authenticatedRequest, collectionId, itemId, { unlockToken: categoryPicker.unlockTokenFor(collectionId) });
        setOriginalCategoryIds(previous => {
          const next = new Set(previous);
          next.delete(collectionId);
          return next;
        });
      } catch (caughtError) {
        failureMessages.push(getCollectionMembershipErrorMessage(caughtError, t));
      }
    }

    setIsSaving(false);
    // De-duplicated - several failed operations of the same kind must not repeat the same sentence.
    const failureText = [...new Set(failureMessages)].join('\n');
    if (proposedIds.size > 0) {
      // One dialog for the whole save: the proposals, then anything that did not go through.
      const outcome = formatSaveOutcomeMessage({ added: addedCount, submitted: proposedIds.size }, t);
      showMessage(failureText ? `${outcome}\n\n${failureText}` : outcome, { title: t('collections.saveOutcomeTitle') });
    } else if (failureText) {
      showMessage(failureText);
    } else {
      showNotificationToast(t('item.saved'));
    }
  };

  /**
   * Deliberately skips Linking.canOpenURL as a pre-check: on Android 11+ that query is subject to
   * package visibility restrictions and can return false for a URL that Linking.openURL would
   * actually open just fine (Juple declares no <queries> entries, and shouldn't need to just to
   * probe "can a browser open http/https" - see AndroidManifest.xml). Item.url is always an
   * absolute http/https URL (enforced at save time - see InboxEntrySaveService), so there's no
   * other scheme to defensively check for here; a real failure (no app can open it at all) still
   * surfaces via this catch.
   */
  const openOriginalUrl = async () => {
    if (!item) {
      return;
    }

    try {
      await Linking.openURL(item.url);
    } catch {
      showMessage(t('item.urlOpenFailed'));
    }
  };

  if (isLoading && !item) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!item) {
    return (
      <View style={styles.loadingContainer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Keeps whatever is being typed (the memo, the comment field) above the keyboard - edge-to-edge Android does not resize the window itself. */}
      <KeyboardSafeView style={styles.keyboardAvoider}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ref={scrollRef}>
        <ContentPreviewCard
          onChangeTitle={text => {
            setTitle(text);
          }}
          previewImageUrl={representativePhotoUrl(representativePhoto)}
          titleAccessibilityLabel={t('item.titleLabel')}
          titlePlaceholder={t('item.titlePlaceholder')}
          titleValue={title}
        >
          <SourceRow
            trailing={
              <Pressable
                accessibilityLabel={t('item.goToUrlA11y')}
                accessibilityRole="button"
                onPress={openOriginalUrl}
                style={styles.iconButton}
              >
                <ExternalLinkIcon color={colors.brand} size={20} />
              </Pressable>
            }
            url={item.url}
          />
        </ContentPreviewCard>

        <CategoryField
          disabled={isSaving}
          error={itemCollectionsError}
          isLoading={isLoadingItemCollections}
          onPress={categoryPicker.open}
          selectedCollections={selectedCategories}
        />

        <Text style={styles.label}>{t('item.memo')}</Text>
        <TextInput
          multiline
          onChangeText={text => {
            setMemo(text);
          }}
          placeholder={t('item.memoPlaceholder')}
          style={styles.memoInput}
          value={memo}
        />

        {isLoadingImages ? (
          <ActivityIndicator style={styles.imagesLoading} />
        ) : (
          <RepresentativePhotoField
            isBusy={isPhotoBusy}
            isRemovable={representativePhoto?.kind === 'uploaded'}
            onChoose={pickAndUploadImage}
            onRemove={removePhoto}
            photoUrl={representativePhotoUrl(representativePhoto)}
          />
        )}

        {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {collaboration.reactions}
        {collaboration.comments ? (
          <View
            onLayout={event => {
              commentsYRef.current = event.nativeEvent.layout.y;
              scrollToCommentsIfPending();
            }}
            testID="item-comments-section"
          >
            {collaboration.comments}
          </View>
        ) : null}
        {collaboration.composer}
      </ScrollView>

      <View
        onLayout={event => setBottomBarHeight(event.nativeEvent.layout.height)}
        style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isItemActionInFlight, busy: isDeletingItem }}
          disabled={isItemActionInFlight}
          onPress={onDeletePress}
          style={[styles.deleteActionButton, isItemActionInFlight && styles.disabledButton]}
          testID="item-details-delete"
        >
          <Text numberOfLines={2} style={styles.deleteActionLabel}>
            {isDeletingItem ? t('common.deleting') : collectionContext ? t('collections.removeFromCollection') : t('common.delete')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !isDirty || isSaving || isDeleted, busy: isSaving }}
          disabled={!isDirty || isSaving || isDeleted}
          onPress={save}
          style={[styles.saveActionButton, (!isDirty || isSaving || isDeleted) && styles.disabledButton]}
        >
          <Text style={styles.saveActionLabel}>
            {isSaving ? t('common.saving') : t('common.save')}
          </Text>
        </Pressable>
      </View>
      </KeyboardSafeView>

      {messageDialog}
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('item.deleteItemConfirmMessage')}
        onCancel={() => setIsDeleteConfirmVisible(false)}
        onConfirm={() => {
          setIsDeleteConfirmVisible(false);
          deleteItemAction();
        }}
        title={t('item.deleteItemConfirmTitle')}
        visible={isDeleteConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collections.removeFromCollection')}
        message={t('collections.unlinkConfirmMessage')}
        onCancel={() => setIsRemoveFromCollectionConfirmVisible(false)}
        onConfirm={() => {
          setIsRemoveFromCollectionConfirmVisible(false);
          removeFromContextCollectionAction();
        }}
        title={t('collections.unlinkConfirmTitle')}
        visible={isRemoveFromCollectionConfirmVisible}
      />


      <ConfirmDialog
        cancelLabel={t('item.continueEditing')}
        confirmLabel={t('item.leave')}
        message={t('item.unsavedChangesMessage')}
        onCancel={() => setIsUnsavedChangesDialogVisible(false)}
        onConfirm={() => {
          setIsUnsavedChangesDialogVisible(false);
          pendingLeaveRef.current?.();
        }}
        title={t('item.unsavedChangesTitle')}
        visible={isUnsavedChangesDialogVisible}
      />

      <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={categoryPicker.collectionPool}
        createError={categoryPicker.createError}
        error={categoryPicker.error}
        isCreateDialogVisible={categoryPicker.isCreateDialogVisible}
        isCreatingCollection={categoryPicker.isCreatingCollection}
        isLoadingMore={categoryPicker.isLoadingMore}
        isLoadingOptions={categoryPicker.isLoadingOptions}
        onClose={categoryPicker.close}
        onCloseCreateDialog={categoryPicker.closeCreateDialog}
        onCreateCollection={categoryPicker.submitNewCollection}
        onLoadMore={categoryPicker.loadMore}
        onOpenCreateDialog={categoryPicker.openCreateDialog}
        onToggle={option => {
          // Only a Collection's Owner may take a link out of it (a server rule): once this link is
          // in a Collection shared with me, deselecting it here would only fail on save.
          if (selectedCategoryIds.has(option.id) && originalCategoryIds.has(option.id) && option.accessRole != null && option.accessRole !== 'owner') {
            showNotificationToast(t('collections.removeFromSharedOwnerOnly'));
            return;
          }
          categoryPicker.requestToggle(option, () =>
            selectedCategoryIds.has(option.id) ? stageRemoveCategory(option.id) : stageAddCategory(option));
        }}
        onUnlockCancel={categoryPicker.cancelUnlock}
        onUnlockGranted={categoryPicker.onUnlockGranted}
        selectedIds={selectedCategoryIds}
        unlockTarget={categoryPicker.unlockTarget}
        visible={categoryPicker.isVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  keyboardAvoider: { flex: 1 },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: spacing.md,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.xs + 2,
  },
  // Icon-only, no border/background box - shared by every secondary row action on this screen
  // (URL open / category edit / photo add) so all three share the same visual alignment and touch
  // target (see this round's "URL open / category edit / photo add ... must share the same visual
  // alignment, touch target, and icon-only treatment"). The Pressable itself is the full min touch
  // target even though the icon drawn inside it is visually compact (size=20).
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  memoInput: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 120,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    textAlignVertical: 'top',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.inputBorder,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  deleteActionButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md + 4,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  deleteActionLabel: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
  },
  saveActionButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  saveActionLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '700',
  },
  imagesLoading: {
    marginVertical: spacing.sm,
  },
});
