import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
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
import {
  addItemToCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
} from '../collections/api/collectionsApi';
import { CategoryField } from '../collections/CategoryField';
import { CategoryPickerModal } from '../collections/CategoryPickerModal';
import { useCategoryPickerModal } from '../collections/useCategoryPickerModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentPreviewCard } from '../components/ContentPreviewCard';
import { SourceRow } from '../components/SourceRow';
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
  effectiveImageUrl,
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
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { checkUrlSafety } from '../urlSafety/api/urlSafetyApi';

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
  return t('collections.errorMembershipFallback');
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

/** Covers a confirmed "set as representative photo" action (see PhotoListEditor's tap+confirm UX) - persists via setItemCoverImage. */
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
  // Setting a new representative photo persists via the same setItemCoverImage call the old
  // cover picker used - see setPhotoAsRepresentative.
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
   * The user confirmed making the photo at `index` (always the non-representative one - see
   * PhotoListEditor's own tap+confirm UX) the new representative/cover photo - optimistically
   * reflects the new order immediately (matching CollectionDetailsScreen's own reorder
   * precedent), persists via the exact same setItemCoverImage endpoint the old cover-picker modal
   * used, and rolls back to the prior cover on failure. Never touches SortOrder - only which
   * image is first is ever affected (see effectiveImages.ts). Still expressed as a from/to
   * reorder internally (reorderList(images, index, 0)) - unchanged from the prior drag-based UX -
   * since that's still exactly what "make this one the representative" means for this list.
   */
  const setPhotoAsRepresentative = async (index: number) => {
    if (isReorderingPhotosRef.current || index === 0) {
      return;
    }

    const reordered = reorderList(effectivePhotoImages, index, 0);
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

  const stageAddCategory = (option: Collection) => {
    setJustSaved(false);
    setSelectedCategories(previous =>
      previous.some(existing => existing.id === option.id) ? previous : [...previous, option],
    );
  };

  // Creating a category itself is not part of this Item's staged membership edit - it is an
  // immediate, item-independent action (like creating a folder to file into later); only actually
  // adding this Item to it is staged, via stageAddCategory. Unlike NewLinkReviewScreen, creating a
  // category here has never auto-selected it for the current Item (see useCategoryPickerModal's
  // own remarks) - this round preserves that exactly.
  const categoryPicker = useCategoryPickerModal(authenticatedRequest, t);

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
        <ContentPreviewCard
          onChangeTitle={text => {
            setTitle(text);
            setJustSaved(false);
          }}
          previewImageUrl={effectivePhotoImages[0] ? effectiveImageUrl(effectivePhotoImages[0]) : null}
          titleAccessibilityLabel={t('item.titleLabel')}
          titlePlaceholder={t('item.titlePlaceholder')}
          titleValue={title}
        >
          <SourceRow
            trailing={
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
            }
            url={item.url}
          />
          {urlOpenError ? <Text style={styles.error}>{urlOpenError}</Text> : null}
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
            onSetRepresentative={setPhotoAsRepresentative}
          />
        )}
        {photoReorderError ? <Text style={styles.error}>{photoReorderError}</Text> : null}

        {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}
        {itemActionError ? <Text style={styles.error}>{itemActionError}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
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

      {justSaved && !isDirty ? (
        <ConfirmDialog
          confirmLabel={t('common.confirm')}
          message={t('item.saved')}
          onConfirm={() => setJustSaved(false)}
          title={t('common.notice')}
          visible
        />
      ) : null}
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

      <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={categoryPicker.collectionPool}
        error={categoryPicker.error}
        isCreatingCollection={categoryPicker.isCreatingCollection}
        isLoadingMore={categoryPicker.isLoadingMore}
        isLoadingOptions={categoryPicker.isLoadingOptions}
        newCollectionName={categoryPicker.newCollectionName}
        onChangeNewCollectionName={categoryPicker.setNewCollectionName}
        onClose={categoryPicker.close}
        onLoadMore={categoryPicker.loadMore}
        onSubmitNewCollection={categoryPicker.submitNewCollection}
        onToggle={option =>
          selectedCategoryIds.has(option.id) ? stageRemoveCategory(option.id) : stageAddCategory(option)
        }
        selectedIds={selectedCategoryIds}
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
