import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
import {
  addItemToCollection,
  createCollection,
  getCollections,
  removeItemFromCollection,
  type Collection,
} from '../collections/api/collectionsApi';
import {
  deleteItemImage,
  getItemImages,
  uploadItemImage,
  type ItemImage,
} from '../images/api/imagesApi';
import {
  deleteItem,
  getItemDetails,
  recordItemOpen,
  updateItemDetails,
  type ItemDetails,
} from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';
import { getPurchases, type Purchase } from '../purchases/api/purchasesApi';
import { getRepeatPurchases, type RepeatPurchase } from '../purchases/api/repeatPurchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';
import { formatIntervalDescription } from '../purchases/repeatPurchaseFormat';

const MAX_ITEM_IMAGES = 10;
// Purchase is a secondary/optional feature on this screen (see the "추가 기능" section below) - only
// the single most recent Purchase is fetched for a compact summary; "전체 보기" leads to the full
// Purchase History screen for everything beyond that.
const ITEM_PURCHASE_SUMMARY_LIMIT = 1;
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

/** Share.share only ever rejects on a genuine native module failure - a user dismissing/canceling the sheet resolves normally, never here. */
function getShareErrorMessage(t: TFunction): string {
  return t('item.shareError');
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
      return t('item.photoLimitError', { max: MAX_ITEM_IMAGES });
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

function getRecentPurchasesErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('item.errorRecentPurchasesFallback');
}

function getLinkedRepeatPurchasesErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('repeatPurchase.listErrorFallback');
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
  const [shareError, setShareError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const [item, setItem] = useState<ItemDetails | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [baselineTitle, setBaselineTitle] = useState('');
  const [baselineMemo, setBaselineMemo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const [images, setImages] = useState<readonly ItemImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [deletingImageIds, setDeletingImageIds] = useState<ReadonlySet<number>>(new Set());
  const [imagesError, setImagesError] = useState<string | null>(null);

  const isUploadingImageRef = useRef(false);
  const deletingImageIdsRef = useRef<Set<number>>(new Set());

  // An Item can belong to any number of Collections at once, so membership is its own list.
  // There is no cap on how many Collections an Item can belong to, so this is genuinely paginated
  // (see loadMoreItemCollections below) rather than assumed to fit in one page.
  const [itemCollections, setItemCollections] = useState<readonly Collection[]>([]);
  const [itemCollectionsNextCursor, setItemCollectionsNextCursor] = useState<string | null>(null);
  const [isLoadingItemCollections, setIsLoadingItemCollections] = useState(true);
  const [isLoadingMoreItemCollections, setIsLoadingMoreItemCollections] = useState(false);
  const loadingMoreItemCollectionsRef = useRef(false);
  const [itemCollectionsError, setItemCollectionsError] = useState<string | null>(null);
  const itemCollectionsRequestIdRef = useRef(0);
  const [removingCollectionId, setRemovingCollectionId] = useState<number | null>(null);

  const [isCollectionModalVisible, setIsCollectionModalVisible] = useState(false);
  // The server excludes Collections the Item already belongs to (excludeItemId - see
  // collectionsApi.ts), so this is exactly the addable set on every page, regardless of how much
  // of itemCollections above has itself been loaded - unlike filtering client-side against a
  // separately-paginated membership list, which could resurface an already-added Collection while
  // its own membership page hadn't loaded yet.
  const [addableCollectionOptions, setAddableCollectionOptions] = useState<readonly Collection[]>([]);
  const [isLoadingCollectionOptions, setIsLoadingCollectionOptions] = useState(false);
  // The user's full Collection list is unbounded (production API, always paginated) - this modal
  // must scroll-loadMore through it rather than assume one page has everything.
  const [collectionOptionsNextCursor, setCollectionOptionsNextCursor] = useState<string | null>(null);
  const [isLoadingMoreCollectionOptions, setIsLoadingMoreCollectionOptions] = useState(false);
  const loadingMoreCollectionOptionsRef = useRef(false);
  const [collectionModalError, setCollectionModalError] = useState<string | null>(null);
  const [addingCollectionId, setAddingCollectionId] = useState<number | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  const isSavingRef = useRef(isSaving);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const [isItemActionInFlight, setIsItemActionInFlight] = useState(false);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [itemActionError, setItemActionError] = useState<string | null>(null);
  const itemActionInFlightRef = useRef(false);
  const isItemDeleteConfirmOpenRef = useRef(false);

  const [recentPurchases, setRecentPurchases] = useState<readonly Purchase[]>([]);
  const [isLoadingPurchases, setIsLoadingPurchases] = useState(true);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);
  // Discards a stale in-flight load's result if a newer one (e.g. a rapid re-focus) has since started.
  const purchasesRequestIdRef = useRef(0);

  // Entirely independent state from item/Purchase History above - a RepeatPurchase load failure
  // never affects the rest of ItemDetails, and vice versa.
  const [linkedRepeatPurchases, setLinkedRepeatPurchases] = useState<readonly RepeatPurchase[]>([]);
  const [isLoadingRepeatPurchases, setIsLoadingRepeatPurchases] = useState(true);
  const [repeatPurchasesError, setRepeatPurchasesError] = useState<string | null>(null);
  const repeatPurchasesRequestIdRef = useRef(0);

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

  const loadRecentPurchases = useCallback(async () => {
    const requestId = ++purchasesRequestIdRef.current;
    setIsLoadingPurchases(true);
    setPurchasesError(null);
    try {
      const page = await getPurchases(authenticatedRequest, {
        itemId,
        limit: ITEM_PURCHASE_SUMMARY_LIMIT,
      });
      if (purchasesRequestIdRef.current !== requestId) {
        return;
      }
      setRecentPurchases(page.purchases);
    } catch (caughtError) {
      if (purchasesRequestIdRef.current !== requestId) {
        return;
      }
      // Failure keeps whatever Purchases are already shown - only the error text changes.
      setPurchasesError(getRecentPurchasesErrorMessage(caughtError, t));
    } finally {
      if (purchasesRequestIdRef.current === requestId) {
        setIsLoadingPurchases(false);
      }
    }
  }, [authenticatedRequest, itemId, t]);

  const loadLinkedRepeatPurchases = useCallback(async () => {
    const requestId = ++repeatPurchasesRequestIdRef.current;
    setIsLoadingRepeatPurchases(true);
    setRepeatPurchasesError(null);
    try {
      // includeDisabled=true so a paused RepeatPurchase (see RepeatPurchaseDetailsScreen's
      // pause/resume) stays visible here too - this is the recovery path for an Item-linked one,
      // same as the Repeat Purchase tab's own "일시중지 포함" toggle.
      const page = await getRepeatPurchases(authenticatedRequest, { itemId, includeDisabled: true });
      if (repeatPurchasesRequestIdRef.current !== requestId) {
        return;
      }
      setLinkedRepeatPurchases(page.repeatPurchases);
    } catch (caughtError) {
      if (repeatPurchasesRequestIdRef.current !== requestId) {
        return;
      }
      // Failure keeps whatever RepeatPurchases are already shown - only the error text changes.
      setRepeatPurchasesError(getLinkedRepeatPurchasesErrorMessage(caughtError, t));
    } finally {
      if (repeatPurchasesRequestIdRef.current === requestId) {
        setIsLoadingRepeatPurchases(false);
      }
    }
  }, [authenticatedRequest, itemId, t]);

  const loadItemCollections = useCallback(async () => {
    const requestId = ++itemCollectionsRequestIdRef.current;
    setIsLoadingItemCollections(true);
    setItemCollectionsError(null);
    try {
      // There is no cap on how many Collections an Item can belong to - "100 is enough" was a
      // false assumption, so this loads one page and exposes loadMoreItemCollections rather than
      // ever silently truncating a large membership list.
      const page = await getCollections(authenticatedRequest, { itemId, limit: COLLECTION_OPTIONS_PAGE_LIMIT });
      if (itemCollectionsRequestIdRef.current !== requestId) {
        return;
      }
      setItemCollections(page.items);
      setItemCollectionsNextCursor(page.nextCursor);
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

  const loadMoreItemCollections = () => {
    if (loadingMoreItemCollectionsRef.current || isLoadingItemCollections || !itemCollectionsNextCursor) {
      return;
    }

    const requestId = itemCollectionsRequestIdRef.current;
    loadingMoreItemCollectionsRef.current = true;
    setIsLoadingMoreItemCollections(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, {
          itemId,
          limit: COLLECTION_OPTIONS_PAGE_LIMIT,
          cursor: itemCollectionsNextCursor,
        });
        if (itemCollectionsRequestIdRef.current !== requestId) {
          return;
        }
        setItemCollections(previous => {
          const seenIds = new Set(previous.map(option => option.id));
          const additional = page.items.filter(option => !seenIds.has(option.id));
          return [...previous, ...additional];
        });
        setItemCollectionsNextCursor(page.nextCursor);
      } catch (caughtError) {
        if (itemCollectionsRequestIdRef.current === requestId) {
          setItemCollectionsError(getItemCollectionsListErrorMessage(caughtError, t));
        }
      } finally {
        loadingMoreItemCollectionsRef.current = false;
        setIsLoadingMoreItemCollections(false);
      }
    })();
  };

  // Refetches on every focus (not just mount), so returning from PurchaseEditor/RepeatPurchaseEditor
  // after a create/edit, from PurchaseDetails after a delete, or from RepeatPurchaseDetails after a
  // state change, shows the current Purchases and linked RepeatPurchases immediately - and now also
  // the current Collection membership, entirely independent of Purchases/RepeatPurchases.
  useFocusEffect(
    useCallback(() => {
      loadRecentPurchases();
      loadLinkedRepeatPurchases();
      loadItemCollections();
    }, [loadRecentPurchases, loadLinkedRepeatPurchases, loadItemCollections]),
  );

  const pickAndUploadImage = async () => {
    if (isUploadingImageRef.current || images.length >= MAX_ITEM_IMAGES) {
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
      // appending preserves the SortOrder ASC, Id ASC order without needing to re-sort.
      setImages(previous => [...previous, uploaded]);
    } catch (caughtError) {
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
    try {
      await deleteItemImage(authenticatedRequest, itemId, imageId);
      setImages(previous => previous.filter(image => image.id !== imageId));
    } catch (caughtError) {
      // Failure leaves the existing UI (the image stays in the list) unchanged.
      setImagesError(getImageDeleteErrorMessage(caughtError, t));
    } finally {
      deletingImageIdsRef.current.delete(imageId);
      setDeletingImageIds(new Set(deletingImageIdsRef.current));
    }
  };

  const confirmDeleteImage = (image: ItemImage) => {
    if (deletingImageIdsRef.current.has(image.id)) {
      return;
    }

    Alert.alert(t('item.deletePhotoConfirmTitle'), t('item.deletePhotoConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteImageAction(image.id),
      },
    ]);
  };

  const removeFromCollection = async (collectionId: number) => {
    if (removingCollectionId !== null) {
      return;
    }

    setRemovingCollectionId(collectionId);
    setItemCollectionsError(null);
    try {
      await removeItemFromCollection(authenticatedRequest, collectionId, itemId);
      setItemCollections(previous => previous.filter(option => option.id !== collectionId));
    } catch (caughtError) {
      setItemCollectionsError(getCollectionMembershipErrorMessage(caughtError, t));
    } finally {
      setRemovingCollectionId(null);
    }
  };

  const openCollectionModal = async () => {
    setIsCollectionModalVisible(true);
    setCollectionModalError(null);
    setNewCollectionName('');
    setIsLoadingCollectionOptions(true);
    try {
      // excludeItemId is server-side, so every page returned here is already guaranteed to
      // exclude Collections the Item belongs to - no client-side filtering against
      // itemCollections needed (and it would be unreliable anyway: itemCollections can itself
      // still be mid-pagination).
      const page = await getCollections(authenticatedRequest, {
        excludeItemId: itemId,
        limit: COLLECTION_OPTIONS_PAGE_LIMIT,
      });
      setAddableCollectionOptions(page.items);
      setCollectionOptionsNextCursor(page.nextCursor);
    } catch (caughtError) {
      setCollectionModalError(getItemCollectionsListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingCollectionOptions(false);
    }
  };

  const closeCollectionModal = () => {
    if (addingCollectionId !== null || isCreatingCollection) {
      return;
    }
    setIsCollectionModalVisible(false);
  };

  const loadMoreCollectionOptions = () => {
    if (
      loadingMoreCollectionOptionsRef.current ||
      isLoadingCollectionOptions ||
      !collectionOptionsNextCursor
    ) {
      return;
    }

    loadingMoreCollectionOptionsRef.current = true;
    setIsLoadingMoreCollectionOptions(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, {
          excludeItemId: itemId,
          limit: COLLECTION_OPTIONS_PAGE_LIMIT,
          cursor: collectionOptionsNextCursor,
        });
        setAddableCollectionOptions(previous => {
          const seenIds = new Set(previous.map(option => option.id));
          const additional = page.items.filter(option => !seenIds.has(option.id));
          return [...previous, ...additional];
        });
        setCollectionOptionsNextCursor(page.nextCursor);
      } catch (caughtError) {
        setCollectionModalError(getItemCollectionsListErrorMessage(caughtError, t));
      } finally {
        loadingMoreCollectionOptionsRef.current = false;
        setIsLoadingMoreCollectionOptions(false);
      }
    })();
  };

  const addToCollection = async (option: Collection) => {
    if (addingCollectionId !== null) {
      return;
    }

    setAddingCollectionId(option.id);
    setCollectionModalError(null);
    try {
      await addItemToCollection(authenticatedRequest, option.id, itemId);
      setItemCollections(previous => [...previous, option]);
      setAddableCollectionOptions(previous => previous.filter(remaining => remaining.id !== option.id));
    } catch (caughtError) {
      setCollectionModalError(getCollectionMembershipErrorMessage(caughtError, t));
    } finally {
      setAddingCollectionId(null);
    }
  };

  const submitNewCollection = async () => {
    if (addingCollectionId !== null || isCreatingCollection) {
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
      const created = await createCollection(authenticatedRequest, trimmedName);
      setAddableCollectionOptions(previous => [...previous, created]);
      setNewCollectionName('');
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
      navigation.goBack();
    } catch (caughtError) {
      setItemActionError(getItemDeleteErrorMessage(caughtError, t));
    } finally {
      itemActionInFlightRef.current = false;
      setIsItemActionInFlight(false);
      setIsDeletingItem(false);
    }
  };

  const confirmDeleteItem = () => {
    if (isItemDeleteConfirmOpenRef.current || itemActionInFlightRef.current) {
      return;
    }
    isItemDeleteConfirmOpenRef.current = true;

    const closeConfirmation = () => {
      isItemDeleteConfirmOpenRef.current = false;
    };

    Alert.alert(t('item.deleteItemConfirmTitle'), t('item.deleteItemConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel', onPress: closeConfirmation },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          closeConfirmation();
          deleteItemAction();
        },
      },
    ], { cancelable: true, onDismiss: closeConfirmation });
  };

  const isDirty = title !== baselineTitle || memo !== baselineMemo;

  usePreventRemove(isDirty, ({ data }) => {
    Alert.alert(
      t('item.unsavedChangesTitle'),
      t('item.unsavedChangesMessage'),
      [
        { text: t('item.continueEditing'), style: 'cancel' },
        {
          text: t('item.leave'),
          style: 'destructive',
          onPress: () => navigation.dispatch(data.action),
        },
      ],
    );
  });

  const save = async () => {
    if (isSavingRef.current || !isDirty) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setJustSaved(false);
    try {
      await updateItemDetails(authenticatedRequest, itemId, { title, memo });
      setBaselineTitle(title);
      setBaselineMemo(memo);
      setJustSaved(true);
    } catch (caughtError) {
      setError(getSaveErrorMessage(caughtError, t));
    } finally {
      setIsSaving(false);
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
      return;
    }

    // Best-effort, after the URL has already opened successfully (My Page → "최근 본 링크" /
    // Recently opened links) - a failure here must never surface as a failure to open the URL
    // itself, which is the actual user-facing action and has already succeeded by this point.
    try {
      await recordItemOpen(authenticatedRequest, itemId);
    } catch {
      // Intentionally silent - see comment above.
    }
  };

  /** Shares the Item's original URL as-is via the OS Share Sheet - never a Juple-branded link. */
  const shareItemAction = async () => {
    if (!item || isSharing) {
      return;
    }

    setIsSharing(true);
    setShareError(null);
    try {
      await shareItem(item.url, title.trim() || null);
    } catch {
      setShareError(getShareErrorMessage(t));
    } finally {
      setIsSharing(false);
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
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
    >
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
      <Text selectable style={styles.url}>
        {item.url}
      </Text>
      <View style={styles.urlActionsRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            openOriginalUrl();
          }}
          style={styles.openUrlButton}
        >
          <Text style={styles.openUrlButtonLabel}>{t('item.openOriginal')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isSharing, busy: isSharing }}
          disabled={isSharing}
          onPress={shareItemAction}
          style={[styles.shareButton, isSharing && styles.disabledButton]}
        >
          <Text style={styles.shareButtonLabel}>{t('item.share')}</Text>
        </Pressable>
      </View>
      {urlOpenError ? <Text style={styles.error}>{urlOpenError}</Text> : null}
      {shareError ? <Text style={styles.error}>{shareError}</Text> : null}

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

      <View style={styles.imagesHeaderRow}>
        <Text style={styles.label}>
          {t('item.photosHeader', { count: images.length, max: MAX_ITEM_IMAGES })}
        </Text>
      </View>

      {isLoadingImages ? (
        <ActivityIndicator style={styles.imagesLoading} />
      ) : (
        <FlatList
          contentContainerStyle={styles.imageListContent}
          data={images}
          horizontal
          keyExtractor={image => image.id.toString()}
          renderItem={({ item: image }) => (
            <View style={styles.imageThumbnailWrapper}>
              {image.readUrl ? (
                <Image source={{ uri: image.readUrl }} style={styles.imageThumbnail} />
              ) : (
                <View style={[styles.imageThumbnail, styles.imageThumbnailFallback]} />
              )}
              <Pressable
                accessibilityLabel={t('item.deletePhotoA11y')}
                accessibilityRole="button"
                accessibilityState={{ disabled: deletingImageIds.has(image.id) }}
                disabled={deletingImageIds.has(image.id)}
                onPress={() => confirmDeleteImage(image)}
                style={styles.imageDeleteButton}
              >
                {deletingImageIds.has(image.id) ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.imageDeleteButtonLabel}>×</Text>
                )}
              </Pressable>
            </View>
          )}
          showsHorizontalScrollIndicator={false}
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: isUploadingImage || images.length >= MAX_ITEM_IMAGES,
          busy: isUploadingImage,
        }}
        disabled={isUploadingImage || images.length >= MAX_ITEM_IMAGES}
        onPress={pickAndUploadImage}
        style={[
          styles.addImageButton,
          (isUploadingImage || images.length >= MAX_ITEM_IMAGES) && styles.disabledButton,
        ]}
      >
        <Text style={styles.addImageButtonLabel}>
          {isUploadingImage
            ? t('item.uploading')
            : images.length >= MAX_ITEM_IMAGES
              ? t('item.photoLimitButton', { max: MAX_ITEM_IMAGES })
              : t('item.addPhoto')}
        </Text>
      </Pressable>

      {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {justSaved && !isDirty ? <Text style={styles.savedMessage}>{t('item.saved')}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !isDirty || isSaving, busy: isSaving }}
        disabled={!isDirty || isSaving}
        onPress={save}
        style={[styles.saveButton, (!isDirty || isSaving) && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? t('common.saving') : t('common.save')}</Text>
      </Pressable>

      <Text style={styles.label}>{t('collections.itemSectionTitle')}</Text>
      {isLoadingItemCollections ? (
        <ActivityIndicator style={styles.purchasesLoading} />
      ) : itemCollections.length > 0 ? (
        itemCollections.map(option => (
          <View key={option.id} style={styles.collectionChipRow}>
            <Text numberOfLines={1} style={styles.collectionChipLabel}>
              {option.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: removingCollectionId !== null,
                busy: removingCollectionId === option.id,
              }}
              disabled={removingCollectionId !== null}
              onPress={() => removeFromCollection(option.id)}
              style={styles.collectionChipRemoveButton}
            >
              <Text style={styles.collectionChipRemoveLabel}>
                {removingCollectionId === option.id
                  ? t('common.processing')
                  : t('collections.removeItem')}
              </Text>
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={styles.purchasesEmpty}>{t('collections.itemSectionEmpty')}</Text>
      )}
      {itemCollectionsNextCursor ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isLoadingMoreItemCollections, busy: isLoadingMoreItemCollections }}
          disabled={isLoadingMoreItemCollections}
          onPress={loadMoreItemCollections}
          style={styles.loadMoreButton}
        >
          <Text style={styles.loadMoreButtonLabel}>
            {isLoadingMoreItemCollections ? t('common.processing') : t('collections.loadMore')}
          </Text>
        </Pressable>
      ) : null}
      {itemCollectionsError ? <Text style={styles.error}>{itemCollectionsError}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={openCollectionModal}
        style={styles.addPurchaseButton}
      >
        <Text style={styles.addPurchaseButtonLabel}>{t('collections.addItem')}</Text>
      </Pressable>

      <Text style={styles.sectionHeading}>{t('item.additionalFeaturesSection')}</Text>

      <Text style={styles.label}>{t('item.purchasesSection')}</Text>
      {isLoadingPurchases ? (
        <ActivityIndicator style={styles.purchasesLoading} />
      ) : recentPurchases.length > 0 ? (
        <>
          {recentPurchases.map(purchase => (
            <Pressable
              accessibilityRole="button"
              key={purchase.id}
              onPress={() => navigation.navigate('PurchaseDetails', { purchaseId: purchase.id })}
              style={styles.purchaseRow}
            >
              <Text numberOfLines={1} style={styles.purchaseRowProductName}>
                {purchase.productName}
              </Text>
              <Text style={styles.purchaseRowDate}>
                {formatDateOnlyForDisplay(purchase.purchaseDate)}
              </Text>
              {purchase.amount !== null && purchase.currencyCode ? (
                // Verbatim decimal string from the API - no Number()/Intl.NumberFormat conversion,
                // since a value like "999999999999999.9999" is not exactly representable as a JS Number.
                <Text style={styles.purchaseRowAmount}>
                  {purchase.amount} {purchase.currencyCode}
                </Text>
              ) : null}
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('PurchaseHistory')}
            style={styles.loadMoreButton}
          >
            <Text style={styles.loadMoreButtonLabel}>{t('item.viewAllPurchases')}</Text>
          </Pressable>
        </>
      ) : !purchasesError ? (
        <>
          <Text style={styles.purchasesEmpty}>{t('item.noPurchases')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              navigation.navigate('PurchaseEditor', {
                itemId,
                // A suggested initial value only - the user can freely change it, and neither the
                // client nor the server ever confirms it automatically (see PurchaseEditorScreen).
                initialProductName: item.title ?? undefined,
              })
            }
            style={styles.addPurchaseButton}
          >
            <Text style={styles.addPurchaseButtonLabel}>{t('item.addPurchase')}</Text>
          </Pressable>
        </>
      ) : null}
      {purchasesError ? <Text style={styles.error}>{purchasesError}</Text> : null}

      <Text style={styles.label}>{t('item.repeatPurchasesSection')}</Text>
      {isLoadingRepeatPurchases ? (
        <ActivityIndicator style={styles.purchasesLoading} />
      ) : linkedRepeatPurchases.length > 0 ? (
        linkedRepeatPurchases.map(repeatPurchase => (
          <Pressable
            accessibilityRole="button"
            key={repeatPurchase.id}
            onPress={() =>
              navigation.navigate('RepeatPurchaseDetails', { repeatPurchaseId: repeatPurchase.id })
            }
            style={styles.purchaseRow}
          >
            <Text numberOfLines={2} style={styles.purchaseRowProductName}>
              {repeatPurchase.productName}
            </Text>
            <Text style={styles.purchaseRowDate}>
              {formatIntervalDescription(t, repeatPurchase.intervalValue, repeatPurchase.intervalUnit)}
              {' · '}
              {t('repeatPurchase.nextPurchaseDateLabel', {
                date: formatDateOnlyForDisplay(repeatPurchase.nextPurchaseDate),
              })}
            </Text>
            {!repeatPurchase.isEnabled ? (
              <Text style={styles.repeatPurchasePausedLabel}>{t('repeatPurchase.paused')}</Text>
            ) : null}
          </Pressable>
        ))
      ) : !repeatPurchasesError ? (
        <Text style={styles.purchasesEmpty}>{t('item.noRepeatPurchases')}</Text>
      ) : null}
      {repeatPurchasesError ? <Text style={styles.error}>{repeatPurchasesError}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          navigation.navigate('RepeatPurchaseEditor', {
            itemId,
            // A suggested initial value only - the user can freely change it, and it is never
            // synced back to Item.Title (see RepeatPurchaseEditorScreen). Always offered alongside
            // the list above (not just when empty) - an Item can have more than one RepeatPurchase.
            initialProductName: item.title ?? undefined,
          })
        }
        style={styles.addPurchaseButton}
      >
        <Text style={styles.addPurchaseButtonLabel}>{t('item.addRepeatPurchase')}</Text>
      </Pressable>

      {itemActionError ? <Text style={styles.error}>{itemActionError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isItemActionInFlight, busy: isDeletingItem }}
        disabled={isItemActionInFlight}
        onPress={confirmDeleteItem}
        style={[styles.itemDeleteButton, isItemActionInFlight && styles.disabledButton]}
      >
        <Text style={styles.itemDeleteButtonLabel}>
          {isDeletingItem ? t('common.deleting') : t('common.delete')}
        </Text>
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={closeCollectionModal}
        transparent
        visible={isCollectionModalVisible}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingBottom: 24 + insets.bottom }]}>
            <Text style={styles.modalTitle}>{t('collections.addItem')}</Text>

            {isLoadingCollectionOptions ? (
              <ActivityIndicator style={styles.modalLoading} />
            ) : (
              <FlatList
                data={addableCollectionOptions}
                keyExtractor={option => option.id.toString()}
                onEndReached={loadMoreCollectionOptions}
                onEndReachedThreshold={0.5}
                ListEmptyComponent={
                  <Text style={styles.manageEmpty}>{t('collections.addModalEmpty')}</Text>
                }
                renderItem={({ item: option }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: addingCollectionId !== null,
                      busy: addingCollectionId === option.id,
                    }}
                    disabled={addingCollectionId !== null}
                    onPress={() => addToCollection(option)}
                    style={[
                      styles.categoryOptionRow,
                      addingCollectionId !== null && styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.categoryOptionLabel}>
                      {addingCollectionId === option.id ? t('common.processing') : option.name}
                    </Text>
                  </Pressable>
                )}
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
              disabled={addingCollectionId !== null || isCreatingCollection}
              onPress={closeCollectionModal}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseLabel}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
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
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
    marginTop: 32,
  },
  titleInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  url: {
    color: '#111111',
    fontSize: 14,
  },
  urlActionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 8,
  },
  openUrlButton: {
    alignSelf: 'flex-start',
    marginEnd: 16,
  },
  openUrlButtonLabel: {
    color: '#3366CC',
    fontSize: 14,
    fontWeight: '600',
  },
  shareButton: {
    alignSelf: 'flex-start',
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  shareButtonLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
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
  saveButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    marginTop: 24,
    paddingVertical: 12,
  },
  disabledButton: {
    opacity: 0.5,
  },
  itemDeleteButton: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 8,
    marginTop: 12,
    paddingVertical: 12,
  },
  itemDeleteButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  imagesHeaderRow: {
    marginTop: 20,
  },
  imagesLoading: {
    marginTop: 12,
  },
  imageListContent: {
    paddingVertical: 4,
  },
  imageThumbnailWrapper: {
    marginEnd: 10,
    position: 'relative',
  },
  imageThumbnail: {
    borderRadius: 8,
    height: 88,
    width: 88,
  },
  imageThumbnailFallback: {
    backgroundColor: '#E0E0E0',
  },
  imageDeleteButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    right: -6,
    top: -6,
    width: 22,
  },
  imageDeleteButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  addImageButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 10,
    paddingVertical: 10,
  },
  addImageButtonLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  saveButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  collectionChipRow: {
    alignItems: 'center',
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  collectionChipLabel: {
    color: '#111111',
    fontSize: 15,
    flex: 1,
    marginEnd: 12,
  },
  collectionChipRemoveButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  collectionChipRemoveLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  loadMoreButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
  },
  loadMoreButtonLabel: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  addPurchaseButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 10,
  },
  addPurchaseButtonLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  purchasesLoading: {
    marginTop: 8,
  },
  purchasesEmpty: {
    color: '#666666',
    fontSize: 14,
  },
  purchaseRow: {
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  purchaseRowProductName: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  purchaseRowDate: {
    color: '#666666',
    fontSize: 13,
    marginTop: 3,
  },
  purchaseRowAmount: {
    color: '#111111',
    fontSize: 13,
    marginTop: 3,
  },
  repeatPurchasePausedLabel: {
    color: '#9A9A9A',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
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
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    paddingVertical: 14,
  },
  categoryOptionLabel: {
    color: '#111111',
    fontSize: 15,
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
