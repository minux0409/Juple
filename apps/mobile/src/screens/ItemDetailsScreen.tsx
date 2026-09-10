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
  updateItemDetails,
  type ItemDetails,
} from '../items/api/itemsApi';
import { shareItem } from '../items/shareItem';
import type { RootStackParamList } from '../navigation/RootStack';

const MAX_ITEM_IMAGES = 10;
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

  // Images are an immediate server mutation, deliberately never staged - unlike title/memo/
  // categories, there is no locally-staged image state for Save to ever commit (see this file's
  // isDirty below, and the "Save semantics" round that settled this).
  const [images, setImages] = useState<readonly ItemImage[]>([]);
  const [isLoadingImages, setIsLoadingImages] = useState(true);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [deletingImageIds, setDeletingImageIds] = useState<ReadonlySet<number>>(new Set());
  const [imagesError, setImagesError] = useState<string | null>(null);

  const isUploadingImageRef = useRef(false);
  const deletingImageIdsRef = useRef<Set<number>>(new Set());

  // The Item's currently-staged Collection membership (selectedCategories) vs. the last known
  // persisted membership (originalCategoryIds) - the diff between the two is exactly what Save
  // must add/remove. There is no cap on how many Collections an Item can belong to, so this is
  // genuinely paginated (see loadMoreItemCollections below) rather than assumed to fit one page.
  const [selectedCategories, setSelectedCategories] = useState<readonly Collection[]>([]);
  const [originalCategoryIds, setOriginalCategoryIds] = useState<ReadonlySet<number>>(new Set());
  const [itemCollectionsNextCursor, setItemCollectionsNextCursor] = useState<string | null>(null);
  const [isLoadingItemCollections, setIsLoadingItemCollections] = useState(true);
  const [isLoadingMoreItemCollections, setIsLoadingMoreItemCollections] = useState(false);
  const loadingMoreItemCollectionsRef = useRef(false);
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
  const itemActionInFlightRef = useRef(false);
  const isItemDeleteConfirmOpenRef = useRef(false);

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
  const addableCollectionOptions = collectionPool.filter(option => !selectedCategoryIds.has(option.id));

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
      setSelectedCategories(page.items);
      setOriginalCategoryIds(new Set(page.items.map(option => option.id)));
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
        setSelectedCategories(previous => {
          const seenIds = new Set(previous.map(option => option.id));
          const additional = page.items.filter(option => !seenIds.has(option.id));
          return [...previous, ...additional];
        });
        setOriginalCategoryIds(previous => {
          const next = new Set(previous);
          for (const option of page.items) {
            next.add(option.id);
          }
          return next;
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
      // appending preserves the SortOrder ASC, Id ASC order without needing to re-sort.
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
    } catch (caughtError) {
      // Failure leaves the existing UI (the image stays in the list) unchanged - never removed
      // client-side unless the server actually confirmed the delete.
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
      // No excludeItemId here on purpose - the addable set must reflect the current staged
      // selection (see addableCollectionOptions above), which the server has no notion of.
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
    if (isSavingRef.current || !isDirty) {
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
      ) : selectedCategories.length > 0 ? (
        selectedCategories.map(option => (
          <View key={option.id} style={styles.collectionChipRow}>
            <Text numberOfLines={1} style={styles.collectionChipLabel}>
              {option.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving }}
              disabled={isSaving}
              onPress={() => stageRemoveCategory(option.id)}
              style={styles.collectionChipRemoveButton}
            >
              <Text style={styles.collectionChipRemoveLabel}>{t('collections.removeItem')}</Text>
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
        accessibilityState={{ disabled: isSaving }}
        disabled={isSaving}
        onPress={openCollectionModal}
        style={styles.addPurchaseButton}
      >
        <Text style={styles.addPurchaseButtonLabel}>{t('collections.addItem')}</Text>
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
                    onPress={() => stageAddCategory(option)}
                    style={styles.categoryOptionRow}
                  >
                    <Text style={styles.categoryOptionLabel}>{option.name}</Text>
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
              disabled={isCreatingCollection}
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
