import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  ScrollView,
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
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import {
  addItemToCollection,
  createCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
} from '../collections/api/collectionsApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditIcon } from '../icons/EditIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import {
  deleteItemImage,
  getItemImages,
  uploadItemImage,
  type ItemImage,
} from '../images/api/imagesApi';
import { PhotoListEditor } from '../images/PhotoListEditor';
import {
  buildEffectiveImages,
  coverImageIdForFront,
  effectiveImageKey,
  MAX_EFFECTIVE_IMAGES,
  reorderList,
  type EffectiveImage,
} from '../items/effectiveImages';
import {
  deleteItem,
  getItemDetails,
  setItemCoverImage,
  updateItemDetails,
  type ItemDetails,
} from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { checkUrlSafety } from '../urlSafety/api/urlSafetyApi';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;
/** How many selected-category chips the compact summary row shows before collapsing the rest into a "+N" chip. */
const CATEGORY_SUMMARY_MAX_CHIPS = 3;

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
  return t('collections.errorMembershipFallback');
}

function getCollectionCreateErrorMessage(error: unknown, t: TFunction): string {
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
  return t('collections.errorCreateFallback');
}

/** Mirrors the backend's CollectionNameNormalizer: trim, required, 100-character limit. */
function getCollectionNameValidationError(name: string, t: TFunction): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return t('collections.errorNameRequired');
  }
  if (trimmedName.length > 100) {
    return t('collections.errorNameTooLong');
  }
  return null;
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
    if (error.kind === 'conflict') {
      return t('item.photoLimitError', { max: MAX_EFFECTIVE_IMAGES });
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

/** Covers both an explicit reorder-drop and the accessibility "첫 번째로 설정" action - both persist via the same setItemCoverImage call. */
function getPhotoReorderErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorPhotoReorderFallback');
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
  const { itemId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  const insets = useSafeAreaInsets();
  const [urlOpenError, setUrlOpenError] = useState<string | null>(null);

  const [item, setItem] = useState<ItemDetails | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [baselineTitle, setBaselineTitle] = useState('');
  const [baselineMemo, setBaselineMemo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Images (and their order/cover) are an immediate server mutation, deliberately never staged -
  // unlike title/memo/categories, there is no locally-staged image state for Save to ever commit
  // (see this file's isDirty below, and the "Save semantics" round that settled this).
  const [images, setImages] = useState<readonly ItemImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [deletingImageIds, setDeletingImageIds] = useState<ReadonlySet<number>>(new Set());
  const [imagesError, setImagesError] = useState<string | null>(null);
  // A reorder (drag, or the "첫 번째로 설정" accessibility action) persists via the same
  // setItemCoverImage call the old cover picker used - see handlePhotoReordered.
  const [isReorderingPhotos, setIsReorderingPhotos] = useState(false);
  const [photoReorderError, setPhotoReorderError] = useState<string | null>(null);
  const isReorderingPhotosRef = useRef(false);

  const isUploadingImageRef = useRef(false);
  const deletingImageIdsRef = useRef<Set<number>>(new Set());

  // The Item's currently-staged Collection membership (selectedCategories) vs. the last known
  // persisted membership (originalCategoryIds) - the diff between the two is exactly what Save
  // must add/remove. There is no cap on how many Collections an Item can belong to, so
  // loadItemCollections below drains every page itself rather than assuming one page is enough.
  const [selectedCategories, setSelectedCategories] = useState<readonly Collection[]>([]);
  const [originalCategoryIds, setOriginalCategoryIds] = useState<ReadonlySet<number>>(new Set());
  const [isLoadingItemCollections, setIsLoadingItemCollections] = useState(true);
  const [itemCollectionsError, setItemCollectionsError] = useState<string | null>(null);
  const itemCollectionsRequestIdRef = useRef(0);

  const [isCollectionModalVisible, setIsCollectionModalVisible] = useState(false);
  // The raw fetched pool of the user's Collections (no server-side excludeItemId anymore - the
  // "addable" set must reflect the current *staged* selection, not the last-persisted membership,
  // so it is computed below by filtering this pool against selectedCategories on every render).
  const [collectionPool, setCollectionPool] = useState<readonly Collection[]>([]);
  const [collectionPoolNextCursor, setCollectionPoolNextCursor] = useState<string | null>(null);
  const [isLoadingCollectionOptions, setIsLoadingCollectionOptions] = useState(false);
  const [isLoadingMoreCollectionOptions, setIsLoadingMoreCollectionOptions] = useState(false);
  const loadingMoreCollectionOptionsRef = useRef(false);
  const [collectionModalError, setCollectionModalError] = useState<string | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  const isSavingRef = useRef(isSaving);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const [isItemActionInFlight, setIsItemActionInFlight] = useState(false);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [itemActionError, setItemActionError] = useState<string | null>(null);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  // Flips true only once the Delete API call has actually succeeded - never before (see
  // deleteItemAction: dirty state itself is never cleared/reset by Delete). Gates both the
  // unsaved-changes guard below and Save, and drives the goBack() effect further down - see that
  // effect's own remarks for why the navigation call itself must live there and not inline in
  // deleteItemAction.
  const [isDeleted, setIsDeleted] = useState(false);
  const [pendingDeleteImageId, setPendingDeleteImageId] = useState<number | null>(null);
  const [isUnsavedChangesDialogVisible, setIsUnsavedChangesDialogVisible] = useState(false);
  // Stashes a closure over usePreventRemove's imperative `data.action`, rather than the action
  // value itself, so this ref never needs to describe that action's shape.
  const pendingLeaveRef = useRef<(() => void) | null>(null);
  const itemActionInFlightRef = useRef(false);

  const [isCheckingUrlSafety, setIsCheckingUrlSafety] = useState(false);
  const [isUrlThreatConfirmVisible, setIsUrlThreatConfirmVisible] = useState(false);

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

  // The single unified "사진" list - see effectiveImages.ts. CoverImageId only ever controls which
  // position is first; it never removes/hides any image, auto or uploaded.
  const effectivePhotoImages = buildEffectiveImages(
    item?.previewImageUrl ?? null, images, item?.coverImage?.id ?? null,
  );

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
        const page = await getCollections(authenticatedRequest, {
          itemId,
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

  const pickAndUploadImage = async () => {
    if (isUploadingImageRef.current || effectivePhotoImages.length >= MAX_EFFECTIVE_IMAGES) {
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

    if (result.didCancel) {
      return;
    }

    const asset = result.assets?.[0];
    if (result.errorCode || !asset?.uri) {
      setImagesError(getImagePickerErrorMessage(result.errorCode, t));
      return;
    }

    isUploadingImageRef.current = true;
    setIsUploadingImage(true);
    setImagesError(null);
    // A stale "저장되었습니다." from an earlier title/memo/category save no longer describes the
    // screen once something else has changed - mirrors title/memo's own onChangeText clearing it.
    setJustSaved(false);
    try {
      // asset.type is whatever the picker actually reports post-conversion - never assumed or
      // overridden to 'image/jpeg' here. The server independently verifies the real format via
      // magic bytes regardless of what this claims.
      const uploaded = await uploadItemImage(authenticatedRequest, itemId, {
        uri: asset.uri,
        type: asset.type,
        fileName: asset.fileName,
      });
      // A fresh upload always receives SortOrder = current max + 1 (server-assigned), so
      // appending preserves the SortOrder ASC, Id ASC order without needing to re-sort. It simply
      // joins the end of the unified list - the user can drag it to the front afterward if they
      // want it to become the Home thumbnail; uploading never auto-promotes it.
      setImages(previous => [...previous, uploaded]);
    } catch (caughtError) {
      // Failure never leaves the UI looking like the upload succeeded - the photo simply never
      // appears, alongside a clear error below the list.
      setImagesError(getImageUploadErrorMessage(caughtError, t));
    } finally {
      isUploadingImageRef.current = false;
      setIsUploadingImage(false);
    }
  };

  const deleteImageAction = async (imageId: number) => {
    if (deletingImageIdsRef.current.has(imageId)) {
      return;
    }

    deletingImageIdsRef.current.add(imageId);
    setDeletingImageIds(new Set(deletingImageIdsRef.current));
    setImagesError(null);
    setJustSaved(false);
    try {
      await deleteItemImage(authenticatedRequest, itemId, imageId);
      setImages(previous => previous.filter(image => image.id !== imageId));
      // Mirrors the server (see ItemImageStore.DeleteAsync): deleting the currently-selected cover
      // image clears it immediately, falling back to the next natural first image, rather than
      // leaving a stale reference until the next full reload.
      setItem(previous =>
        previous && previous.coverImage?.id === imageId ? { ...previous, coverImage: null } : previous,
      );
    } catch (caughtError) {
      // Failure leaves the existing UI (the image stays in the list) unchanged - never removed
      // client-side unless the server actually confirmed the delete.
      setImagesError(getImageDeleteErrorMessage(caughtError, t));
    } finally {
      deletingImageIdsRef.current.delete(imageId);
      setDeletingImageIds(new Set(deletingImageIdsRef.current));
    }
  };

  const confirmDeleteImage = (image: EffectiveImage) => {
    if (image.kind !== 'uploaded' || deletingImageIdsRef.current.has(image.image.id)) {
      return;
    }

    setPendingDeleteImageId(image.image.id);
  };

  /**
   * A drag-drop (or the "첫 번째로 설정" accessibility action) - optimistically reflects the new
   * order immediately (matching CollectionDetailsScreen's own reorder precedent), persists via the
   * exact same setItemCoverImage endpoint the old cover-picker modal used, and rolls back to the
   * prior cover on failure. Never touches SortOrder - only which image is first is ever affected
   * (see effectiveImages.ts).
   */
  const handlePhotoReordered = async (fromIndex: number, toIndex: number) => {
    if (isReorderingPhotosRef.current || fromIndex === toIndex) {
      return;
    }

    const reordered = reorderList(effectivePhotoImages, fromIndex, toIndex);
    const front = reordered[0];
    const newCoverImageId = coverImageIdForFront(reordered);
    if (newCoverImageId === (item?.coverImage?.id ?? null)) {
      return;
    }
    const newCoverImage =
      front?.kind === 'uploaded' && front.image.readUrl !== null
        ? { id: front.image.id, readUrl: front.image.readUrl }
        : null;

    const previousCoverImage = item?.coverImage ?? null;
    setPhotoReorderError(null);
    setItem(previous => (previous ? { ...previous, coverImage: newCoverImage } : previous));

    isReorderingPhotosRef.current = true;
    setIsReorderingPhotos(true);
    try {
      await setItemCoverImage(authenticatedRequest, itemId, newCoverImageId);
    } catch (caughtError) {
      setItem(previous => (previous ? { ...previous, coverImage: previousCoverImage } : previous));
      setPhotoReorderError(getPhotoReorderErrorMessage(caughtError, t));
    } finally {
      isReorderingPhotosRef.current = false;
      setIsReorderingPhotos(false);
    }
  };

  const stageRemoveCategory = (collectionId: number) => {
    setJustSaved(false);
    setSelectedCategories(previous => previous.filter(option => option.id !== collectionId));
  };

  const openCollectionModal = async () => {
    setIsCollectionModalVisible(true);
    setCollectionModalError(null);
    setNewCollectionName('');
    setIsLoadingCollectionOptions(true);
    try {
      // No itemId/excludeItemId here on purpose - this modal shows every Collection with a
      // selected/unselected toggle (see selectedCategoryIds), which must reflect the current
      // staged selection, not a server-side filter the server has no notion of.
      const page = await getCollections(authenticatedRequest, { limit: COLLECTION_OPTIONS_PAGE_LIMIT });
      setCollectionPool(page.items);
      setCollectionPoolNextCursor(page.nextCursor);
    } catch (caughtError) {
      setCollectionModalError(getItemCollectionsListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingCollectionOptions(false);
    }
  };

  const closeCollectionModal = () => {
    if (isCreatingCollection) {
      return;
    }
    setIsCollectionModalVisible(false);
  };

  const loadMoreCollectionOptions = () => {
    if (
      loadingMoreCollectionOptionsRef.current ||
      isLoadingCollectionOptions ||
      !collectionPoolNextCursor
    ) {
      return;
    }

    loadingMoreCollectionOptionsRef.current = true;
    setIsLoadingMoreCollectionOptions(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, {
          limit: COLLECTION_OPTIONS_PAGE_LIMIT,
          cursor: collectionPoolNextCursor,
        });
        setCollectionPool(previous => {
          const seenIds = new Set(previous.map(option => option.id));
          const additional = page.items.filter(option => !seenIds.has(option.id));
          return [...previous, ...additional];
        });
        setCollectionPoolNextCursor(page.nextCursor);
      } catch (caughtError) {
        setCollectionModalError(getItemCollectionsListErrorMessage(caughtError, t));
      } finally {
        loadingMoreCollectionOptionsRef.current = false;
        setIsLoadingMoreCollectionOptions(false);
      }
    })();
  };

  const stageAddCategory = (option: Collection) => {
    setJustSaved(false);
    setSelectedCategories(previous =>
      previous.some(existing => existing.id === option.id) ? previous : [...previous, option],
    );
  };

  const submitNewCollection = async () => {
    if (isCreatingCollection) {
      return;
    }

    const validationError = getCollectionNameValidationError(newCollectionName, t);
    if (validationError) {
      setCollectionModalError(validationError);
      return;
    }
    const trimmedName = newCollectionName.trim();

    setIsCreatingCollection(true);
    setCollectionModalError(null);
    try {
      // Creating the category itself is not part of this Item's staged membership edit - it is an
      // immediate, item-independent action (like creating a folder to file into later); only
      // actually adding this Item to it is staged, via stageAddCategory below.
      const created = await createCollection(authenticatedRequest, trimmedName);
      setCollectionPool(previous => [...previous, created]);
      setNewCollectionName('');
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setCollectionModalError(getCollectionCreateErrorMessage(caughtError, t));
    } finally {
      setIsCreatingCollection(false);
    }
  };

  const deleteItemAction = async () => {
    if (itemActionInFlightRef.current) {
      return;
    }

    itemActionInFlightRef.current = true;
    setIsItemActionInFlight(true);
    setIsDeletingItem(true);
    setItemActionError(null);
    try {
      await deleteItem(authenticatedRequest, itemId);
      // Does NOT call navigation.goBack() directly here - see the isDeleted effect below for why
      // the actual navigation must wait for this state update to actually commit first.
      setIsDeleted(true);
    } catch (caughtError) {
      setItemActionError(getItemDeleteErrorMessage(caughtError, t));
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
    setJustSaved(false);

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

    for (const option of categoriesToAdd) {
      try {
        await addItemToCollection(authenticatedRequest, option.id, itemId);
        setOriginalCategoryIds(previous => new Set(previous).add(option.id));
      } catch (caughtError) {
        failureMessages.push(getCollectionMembershipErrorMessage(caughtError, t));
      }
    }
    for (const collectionId of categoryIdsToRemove) {
      try {
        await removeItemFromCollection(authenticatedRequest, collectionId, itemId);
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
    if (failureMessages.length > 0) {
      // De-duplicated - several failed operations of the same kind must not repeat the same
      // sentence over and over.
      setError([...new Set(failureMessages)].join('\n'));
    } else {
      setJustSaved(true);
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

    setUrlOpenError(null);
    try {
      await Linking.openURL(item.url);
    } catch {
      setUrlOpenError(t('item.urlOpenFailed'));
    }
  };

  /**
   * Checked on demand at the moment the URL-open action is pressed, not persisted/pre-fetched on screen load -
   * URL safety has no Item-level storage yet (see docs on UrlSafety's first round). Only an actual
   * confirmed ThreatDetected result interrupts navigation with ConfirmDialog below; a failed/
   * unavailable check (network error, provider down, rate-limited) never blocks opening the link -
   * same "never a hard dependency" principle as everywhere else this feature appears.
   */
  const handleGoToUrlPress = async () => {
    if (!item || isCheckingUrlSafety) {
      return;
    }

    setIsCheckingUrlSafety(true);
    try {
      const result = await checkUrlSafety(authenticatedRequest, item.url);
      if (result.status === 'threatDetected') {
        setIsUrlThreatConfirmVisible(true);
        return;
      }
    } catch {
      // Treated the same as checkUnavailable - falls through to opening the URL below.
    } finally {
      setIsCheckingUrlSafety(false);
    }

    await openOriginalUrl();
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>{t('item.titleLabel')}</Text>
        <TextInput
          onChangeText={text => {
            setTitle(text);
            setJustSaved(false);
          }}
          placeholder={t('item.titlePlaceholder')}
          style={styles.titleInput}
          value={title}
        />

        <Text style={styles.label}>{t('item.url')}</Text>
        <View style={styles.urlRow}>
          {/*
            Deliberately not `selectable`: on Android, selectable Text ignores numberOfLines
            truncation and renders a wrapped, vertically-clipped second line instead of a
            single-line ellipsis (long-standing React Native Android issue - reproduced on
            narrow/split-screen widths). The URL can still be opened via the button next to it.
          */}
          <Text numberOfLines={1} style={[styles.url, ltrTextStyle]}>
            {item.url}
          </Text>
          <Pressable
            accessibilityLabel={t('item.goToUrlA11y')}
            accessibilityRole="button"
            accessibilityState={{ disabled: isCheckingUrlSafety, busy: isCheckingUrlSafety }}
            disabled={isCheckingUrlSafety}
            onPress={handleGoToUrlPress}
            style={[styles.iconButton, isCheckingUrlSafety && styles.disabledButton]}
          >
            {isCheckingUrlSafety ? (
              <ActivityIndicator color={colors.brand} size="small" />
            ) : (
              <ExternalLinkIcon color={colors.brand} size={20} />
            )}
          </Pressable>
        </View>
        {urlOpenError ? <Text style={styles.error}>{urlOpenError}</Text> : null}

        <Text style={styles.label}>{t('collections.itemSectionTitle')}</Text>
        {isLoadingItemCollections ? (
          <ActivityIndicator style={styles.purchasesLoading} />
        ) : (
          <Pressable
            accessibilityLabel={t('item.categoryEditA11y')}
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
            disabled={isSaving}
            onPress={openCollectionModal}
            style={styles.categorySummaryRow}
          >
            <View style={styles.categorySummaryChips}>
              {selectedCategories.length === 0 ? (
                <Text style={styles.purchasesEmpty}>{t('collections.itemSectionEmpty')}</Text>
              ) : (
                <>
                  {selectedCategories.slice(0, CATEGORY_SUMMARY_MAX_CHIPS).map(option => (
                    <View key={option.id} style={styles.categorySummaryChip}>
                      <Text numberOfLines={1} style={styles.categorySummaryChipLabel}>
                        {option.name}
                      </Text>
                    </View>
                  ))}
                  {selectedCategories.length > CATEGORY_SUMMARY_MAX_CHIPS ? (
                    <View style={styles.categorySummaryChip}>
                      <Text style={styles.categorySummaryChipLabel}>
                        {`+${selectedCategories.length - CATEGORY_SUMMARY_MAX_CHIPS}`}
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.iconButton}>
              <EditIcon color={colors.textPrimary} size={20} />
            </View>
          </Pressable>
        )}
        {itemCollectionsError ? <Text style={styles.error}>{itemCollectionsError}</Text> : null}

        <Text style={styles.label}>{t('item.memo')}</Text>
        <TextInput
          multiline
          onChangeText={text => {
            setMemo(text);
            setJustSaved(false);
          }}
          placeholder={t('item.memoPlaceholder')}
          style={styles.memoInput}
          value={memo}
        />

        {isLoadingImages ? (
          <ActivityIndicator style={styles.imagesLoading} />
        ) : (
          <PhotoListEditor
            deletingKeys={
              new Set(
                effectivePhotoImages
                  .filter(image => image.kind === 'uploaded' && deletingImageIds.has(image.image.id))
                  .map(effectiveImageKey),
              )
            }
            images={effectivePhotoImages}
            isAdding={isUploadingImage || isReorderingPhotos}
            onAddPhoto={pickAndUploadImage}
            onDeleteImage={confirmDeleteImage}
            onReorder={handlePhotoReordered}
          />
        )}
        {photoReorderError ? <Text style={styles.error}>{photoReorderError}</Text> : null}

        {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}
        {itemActionError ? <Text style={styles.error}>{itemActionError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {justSaved && !isDirty ? <Text style={styles.savedMessage}>{t('item.saved')}</Text> : null}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: spacing.md + insets.bottom }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isItemActionInFlight, busy: isDeletingItem }}
          disabled={isItemActionInFlight}
          onPress={confirmDeleteItem}
          style={[styles.deleteActionButton, isItemActionInFlight && styles.disabledButton]}
        >
          <Text style={styles.deleteActionLabel}>
            {isDeletingItem ? t('common.deleting') : t('common.delete')}
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
        confirmLabel={t('item.urlSafetyGoAnyway')}
        message={t('item.urlSafetyThreatMessage')}
        onCancel={() => setIsUrlThreatConfirmVisible(false)}
        onConfirm={() => {
          setIsUrlThreatConfirmVisible(false);
          openOriginalUrl();
        }}
        title={t('item.urlSafetyThreatTitle')}
        visible={isUrlThreatConfirmVisible}
      />

      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message={t('item.deletePhotoConfirmMessage')}
        onCancel={() => setPendingDeleteImageId(null)}
        onConfirm={() => {
          const imageId = pendingDeleteImageId;
          setPendingDeleteImageId(null);
          if (imageId !== null) {
            deleteImageAction(imageId);
          }
        }}
        title={t('item.deletePhotoConfirmTitle')}
        visible={pendingDeleteImageId !== null}
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

      <Modal
        animationType="slide"
        onRequestClose={closeCollectionModal}
        transparent
        visible={isCollectionModalVisible}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 24 + insets.bottom }]}>
            <Text style={styles.modalTitle}>{t('collections.selectTitle')}</Text>

            {isLoadingCollectionOptions ? (
              <ActivityIndicator style={styles.modalLoading} />
            ) : (
              <FlatList
                data={collectionPool}
                extraData={selectedCategoryIds}
                keyExtractor={option => option.id.toString()}
                onEndReached={loadMoreCollectionOptions}
                onEndReachedThreshold={0.5}
                ListEmptyComponent={
                  <Text style={styles.manageEmpty}>{t('collections.addModalEmpty')}</Text>
                }
                renderItem={({ item: option }) => {
                  const isSelected = selectedCategoryIds.has(option.id);
                  return (
                    <Pressable
                      accessibilityLabel={option.name}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      onPress={() =>
                        isSelected ? stageRemoveCategory(option.id) : stageAddCategory(option)
                      }
                      style={styles.categoryOptionRow}
                    >
                      <Text numberOfLines={1} style={styles.categoryOptionLabel}>
                        {option.name}
                      </Text>
                      <View style={[styles.categoryOptionCheckCircle, isSelected && styles.categoryOptionCheckCircleSelected]}>
                        {isSelected ? <Text style={styles.categoryOptionCheckMark}>✓</Text> : null}
                      </View>
                    </Pressable>
                  );
                }}
                ListFooterComponent={
                  isLoadingMoreCollectionOptions ? (
                    <View style={styles.modalFooterLoading}>
                      <ActivityIndicator />
                    </View>
                  ) : undefined
                }
                style={styles.categoryOptionList}
              />
            )}

            {collectionModalError ? <Text style={styles.error}>{collectionModalError}</Text> : null}

            <Text style={styles.label}>{t('collections.create')}</Text>
            <View style={styles.newCategoryRow}>
              <TextInput
                editable={!isCreatingCollection}
                onChangeText={setNewCollectionName}
                placeholder={t('collections.namePlaceholder')}
                style={styles.newCategoryInput}
                value={newCollectionName}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !newCollectionName.trim() || isCreatingCollection,
                  busy: isCreatingCollection,
                }}
                disabled={!newCollectionName.trim() || isCreatingCollection}
                onPress={submitNewCollection}
                style={[
                  styles.newCategoryButton,
                  (!newCollectionName.trim() || isCreatingCollection) && styles.disabledButton,
                ]}
              >
                <Text style={styles.newCategoryButtonLabel}>{t('collections.create')}</Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              disabled={isCreatingCollection}
              onPress={closeCollectionModal}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666666',
    marginTop: 20,
    marginBottom: 6,
  },
  titleInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  urlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  url: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    marginEnd: spacing.md,
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
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 16,
  },
  savedMessage: {
    color: '#0F7A3D',
    fontSize: 14,
    marginTop: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  deleteActionButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  deleteActionLabel: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '600',
  },
  saveActionButton: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  saveActionLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
  imagesLoading: {
    marginTop: 12,
  },
  // Compact summary row: at most CATEGORY_SUMMARY_MAX_CHIPS selected-category chips (+ a "+N"
  // chip for the rest), never the full list - tapping anywhere in the row opens the picker Modal,
  // which is where the full list/add/remove actually lives (see the Modal below). This is what
  // keeps this screen's own height independent of how many categories are selected.
  categorySummaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categorySummaryChips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginEnd: 12,
  },
  categorySummaryChip: {
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    // Caps a single chip's width so one long category name can never push the "+N" chip or the
    // edit icon off-screen - it truncates with an ellipsis (numberOfLines=1) instead.
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categorySummaryChipLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  purchasesLoading: {
    marginTop: 8,
  },
  purchasesEmpty: {
    color: '#666666',
    fontSize: 14,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalLoading: {
    marginVertical: 20,
  },
  modalFooterLoading: {
    paddingVertical: 12,
  },
  categoryOptionList: {
    maxHeight: 260,
  },
  categoryOptionRow: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  categoryOptionLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    marginEnd: spacing.md,
  },
  // A check-circle (empty outline when unselected, filled brand-colored circle with a white
  // checkmark when selected) - replaces the old full-row gray background + bare "✓" character,
  // which read as an accidental disabled-row state rather than an intentional selection control.
  categoryOptionCheckCircle: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  categoryOptionCheckCircleSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  categoryOptionCheckMark: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  newCategoryRow: {
    flexDirection: 'row',
  },
  newCategoryInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    marginEnd: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  newCategoryButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  newCategoryButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  manageEmpty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  modalCloseButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 12,
  },
  modalCloseLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
