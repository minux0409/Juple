import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi, type AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import {
  createCategory,
  deleteCategory,
  getCategories,
  renameCategory,
  type Category,
  type ItemCategory,
} from '../categories/api/categoriesApi';
import {
  deleteItemImage,
  getItemImages,
  uploadItemImage,
  type ItemImage,
} from '../images/api/imagesApi';
import {
  deleteItem,
  getItemDetails,
  moveItemToArchive,
  moveItemToWishlist,
  setItemCategory,
  updateItemDetails,
  type ItemDetails,
} from '../items/api/itemsApi';
import type { RootStackParamList } from '../navigation/RootStack';
import { getPurchases, type Purchase } from '../purchases/api/purchasesApi';
import { formatDateOnlyForDisplay } from '../purchases/dateOnly';

const MAX_ITEM_IMAGES = 10;
const RECENT_PURCHASES_LIMIT = 3;

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetails'>;

function getLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '항목을 불러올 수 없습니다.';
}

function getSaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '입력한 내용을 확인해 주세요.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return '변경 사항을 저장할 수 없습니다.';
}

function getCategoryListErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '카테고리 목록을 불러올 수 없습니다.';
}

function getCategoryAssignErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '카테고리를 변경할 수 없습니다.';
}

function getCategoryNameSaveErrorMessage(error: unknown, isRename: boolean): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return '이미 같은 이름의 카테고리가 있습니다.';
    }
    if (error.kind === 'badRequest') {
      return '카테고리 이름을 확인해 주세요.';
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
  }
  return isRename ? '카테고리 이름을 변경할 수 없습니다.' : '카테고리를 생성할 수 없습니다.';
}

function getCategoryDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '카테고리를 삭제할 수 없습니다.';
}

function getImageListErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '사진 목록을 불러올 수 없습니다.';
}

/** Never surfaces raw server/credential/token detail - only a short, actionable Korean message. */
function getImageUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'badRequest') {
      return '지원하지 않는 사진 형식이거나 파일 용량이 너무 큽니다.';
    }
    if (error.kind === 'conflict') {
      return `사진은 최대 ${MAX_ITEM_IMAGES}장까지 추가할 수 있습니다.`;
    }
    if (error.kind === 'unauthorized') {
      return '인증 상태를 다시 확인할 수 없습니다.';
    }
    if (error.kind === 'timeout' || error.kind === 'unavailable') {
      return '네트워크 상태를 확인한 뒤 다시 시도해 주세요.';
    }
  }
  return '사진을 업로드할 수 없습니다.';
}

function getImageDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '사진을 삭제할 수 없습니다.';
}

function getRecentPurchasesErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return '구매 기록을 불러올 수 없습니다.';
}

function getItemLifecycleErrorMessage(error: unknown, isDelete: boolean): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return '인증 상태를 다시 확인할 수 없습니다.';
  }
  return isDelete ? '항목을 삭제할 수 없습니다.' : '항목 상태를 변경할 수 없습니다.';
}

/** picker/permission failures never reach the server, so this maps react-native-image-picker's own errorCode only. */
function getImagePickerErrorMessage(errorCode: string | undefined): string {
  if (errorCode === 'permission') {
    return '사진 보관함 접근 권한이 필요합니다.';
  }
  return '사진을 선택할 수 없습니다.';
}

/** Mirrors the backend's CategoryNameNormalizer: trim, required, 100-character limit. */
function getCategoryNameValidationError(name: string): string | null {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return '카테고리 이름을 입력해 주세요.';
  }
  if (trimmedName.length > 100) {
    return '카테고리 이름은 100자 이하로 입력해 주세요.';
  }
  return null;
}

export function ItemDetailsScreen({ route, navigation }: Props) {
  const { itemId } = route.params;
  const authenticatedRequest = useAuthenticatedApi();

  const [item, setItem] = useState<ItemDetails | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [baselineTitle, setBaselineTitle] = useState('');
  const [baselineMemo, setBaselineMemo] = useState('');
  const [category, setCategory] = useState<ItemCategory | null>(null);
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

  const [isCategoryModalVisible, setIsCategoryModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<'select' | 'manage'>('select');
  const [categoryOptions, setCategoryOptions] = useState<readonly Category[]>([]);
  const [isLoadingCategoryOptions, setIsLoadingCategoryOptions] = useState(false);
  const [categoryModalError, setCategoryModalError] = useState<string | null>(null);
  const [isCategoryActionInFlight, setIsCategoryActionInFlight] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [renamingCategoryId, setRenamingCategoryId] = useState<number | null>(null);
  const [renameDraftName, setRenameDraftName] = useState('');

  const isSavingRef = useRef(isSaving);
  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const isCategoryActionInFlightRef = useRef(isCategoryActionInFlight);
  useEffect(() => {
    isCategoryActionInFlightRef.current = isCategoryActionInFlight;
  }, [isCategoryActionInFlight]);

  const isCategoryDeleteConfirmOpenRef = useRef(false);

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
      setCategory(details.category);
    } catch (caughtError) {
      setError(getLoadErrorMessage(caughtError));
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, itemId]);

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
      setImagesError(getImageListErrorMessage(caughtError));
    } finally {
      setIsLoadingImages(false);
    }
  }, [authenticatedRequest, itemId]);

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
        limit: RECENT_PURCHASES_LIMIT,
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
      setPurchasesError(getRecentPurchasesErrorMessage(caughtError));
    } finally {
      if (purchasesRequestIdRef.current === requestId) {
        setIsLoadingPurchases(false);
      }
    }
  }, [authenticatedRequest, itemId]);

  // Refetches on every focus (not just mount), so returning from PurchaseEditor after a
  // create/edit, or from PurchaseDetails after a delete, shows the current Purchases immediately.
  useFocusEffect(
    useCallback(() => {
      loadRecentPurchases();
    }, [loadRecentPurchases]),
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
      setImagesError(getImagePickerErrorMessage(result.errorCode));
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
      setImagesError(getImageUploadErrorMessage(caughtError));
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
      setImagesError(getImageDeleteErrorMessage(caughtError));
    } finally {
      deletingImageIdsRef.current.delete(imageId);
      setDeletingImageIds(new Set(deletingImageIdsRef.current));
    }
  };

  const confirmDeleteImage = (image: ItemImage) => {
    if (deletingImageIdsRef.current.has(image.id)) {
      return;
    }

    Alert.alert('사진을 삭제할까요?', '삭제한 사진은 복구할 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => deleteImageAction(image.id),
      },
    ]);
  };

  const openCategoryModal = async () => {
    setIsCategoryModalVisible(true);
    setModalMode('select');
    setCategoryModalError(null);
    setNewCategoryName('');
    setRenamingCategoryId(null);
    setRenameDraftName('');
    setIsLoadingCategoryOptions(true);
    try {
      const categories = await getCategories(authenticatedRequest);
      setCategoryOptions(categories);
    } catch (caughtError) {
      setCategoryModalError(getCategoryListErrorMessage(caughtError));
    } finally {
      setIsLoadingCategoryOptions(false);
    }
  };

  const closeCategoryModal = () => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }
    setIsCategoryModalVisible(false);
  };

  const openCategoryManage = () => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }
    setModalMode('manage');
    setCategoryModalError(null);
  };

  const closeCategoryManage = () => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }
    setModalMode('select');
    setRenamingCategoryId(null);
    setRenameDraftName('');
    setCategoryModalError(null);
  };

  const selectCategory = async (selected: ItemCategory | null) => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }

    setIsCategoryActionInFlight(true);
    setCategoryModalError(null);
    try {
      await setItemCategory(authenticatedRequest, itemId, selected?.id ?? null);
      setCategory(selected);
      setIsCategoryModalVisible(false);
    } catch (caughtError) {
      setCategoryModalError(getCategoryAssignErrorMessage(caughtError));
    } finally {
      setIsCategoryActionInFlight(false);
    }
  };

  const submitNewCategory = async () => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }

    const validationError = getCategoryNameValidationError(newCategoryName);
    if (validationError) {
      setCategoryModalError(validationError);
      return;
    }
    const trimmedName = newCategoryName.trim();

    setIsCategoryActionInFlight(true);
    setCategoryModalError(null);
    try {
      const created = await createCategory(authenticatedRequest, trimmedName);
      setCategoryOptions(previous => [...previous, created]);
      setNewCategoryName('');
    } catch (caughtError) {
      setCategoryModalError(getCategoryNameSaveErrorMessage(caughtError, false));
    } finally {
      setIsCategoryActionInFlight(false);
    }
  };

  const startRename = (option: Category) => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }
    setRenamingCategoryId(option.id);
    setRenameDraftName(option.name);
    setCategoryModalError(null);
  };

  const cancelRename = () => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }
    setRenamingCategoryId(null);
    setRenameDraftName('');
    setCategoryModalError(null);
  };

  const submitRename = async () => {
    if (renamingCategoryId === null || isCategoryActionInFlightRef.current) {
      return;
    }

    const validationError = getCategoryNameValidationError(renameDraftName);
    if (validationError) {
      setCategoryModalError(validationError);
      return;
    }
    const trimmedName = renameDraftName.trim();
    const categoryId = renamingCategoryId;

    setIsCategoryActionInFlight(true);
    setCategoryModalError(null);
    try {
      await renameCategory(authenticatedRequest, categoryId, trimmedName);
      setCategoryOptions(previous =>
        previous.map(option =>
          option.id === categoryId ? { ...option, name: trimmedName } : option,
        ),
      );
      setCategory(previous =>
        previous && previous.id === categoryId ? { ...previous, name: trimmedName } : previous,
      );
      setRenamingCategoryId(null);
      setRenameDraftName('');
    } catch (caughtError) {
      setCategoryModalError(getCategoryNameSaveErrorMessage(caughtError, true));
    } finally {
      setIsCategoryActionInFlight(false);
    }
  };

  const deleteCategoryAction = async (categoryId: number) => {
    if (isCategoryActionInFlightRef.current) {
      return;
    }

    setIsCategoryActionInFlight(true);
    setCategoryModalError(null);
    try {
      await deleteCategory(authenticatedRequest, categoryId);
      setCategoryOptions(previous => previous.filter(option => option.id !== categoryId));
      setCategory(previous => (previous && previous.id === categoryId ? null : previous));
      if (renamingCategoryId === categoryId) {
        setRenamingCategoryId(null);
        setRenameDraftName('');
      }
    } catch (caughtError) {
      setCategoryModalError(getCategoryDeleteErrorMessage(caughtError));
    } finally {
      setIsCategoryActionInFlight(false);
    }
  };

  const confirmDeleteCategory = (option: Category) => {
    if (isCategoryDeleteConfirmOpenRef.current || isCategoryActionInFlightRef.current) {
      return;
    }
    isCategoryDeleteConfirmOpenRef.current = true;

    const closeConfirmation = () => {
      isCategoryDeleteConfirmOpenRef.current = false;
    };

    Alert.alert(
      '카테고리를 삭제할까요?',
      '이 카테고리가 지정된 항목은 카테고리 없음으로 변경됩니다.',
      [
        { text: '취소', style: 'cancel', onPress: closeConfirmation },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => {
            closeConfirmation();
            deleteCategoryAction(option.id);
          },
        },
      ],
      { cancelable: true, onDismiss: closeConfirmation },
    );
  };

  const runItemStateTransition = async (
    action: (request: AuthenticatedApiRequest, id: number) => Promise<void>,
    targetState: ItemDetails['state'],
  ) => {
    if (itemActionInFlightRef.current) {
      return;
    }

    itemActionInFlightRef.current = true;
    setIsItemActionInFlight(true);
    setItemActionError(null);
    try {
      await action(authenticatedRequest, itemId);
      setItem(previous => (previous ? { ...previous, state: targetState } : previous));
    } catch (caughtError) {
      setItemActionError(getItemLifecycleErrorMessage(caughtError, false));
    } finally {
      itemActionInFlightRef.current = false;
      setIsItemActionInFlight(false);
    }
  };

  const moveToWishlistAction = () => runItemStateTransition(moveItemToWishlist, 'wishlist');
  const moveToArchiveAction = () => runItemStateTransition(moveItemToArchive, 'archived');

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
      setItemActionError(getItemLifecycleErrorMessage(caughtError, true));
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

    Alert.alert('항목을 삭제할까요?', '삭제한 항목은 복구할 수 없습니다.', [
      { text: '취소', style: 'cancel', onPress: closeConfirmation },
      {
        text: '삭제',
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
      '저장하지 않은 변경 사항',
      '저장하지 않고 나가면 변경 사항이 사라집니다.',
      [
        { text: '계속 편집', style: 'cancel' },
        {
          text: '나가기',
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
      setError(getSaveErrorMessage(caughtError));
    } finally {
      setIsSaving(false);
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
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.label}>제목</Text>
      <TextInput
        onChangeText={text => {
          setTitle(text);
          setJustSaved(false);
        }}
        placeholder="제목을 입력해 주세요"
        style={styles.titleInput}
        value={title}
      />

      <Text style={styles.label}>URL</Text>
      <Text selectable style={styles.url}>
        {item.url}
      </Text>

      <Text style={styles.label}>메모</Text>
      <TextInput
        multiline
        onChangeText={text => {
          setMemo(text);
          setJustSaved(false);
        }}
        placeholder="메모를 입력해 주세요"
        style={styles.memoInput}
        value={memo}
      />

      <Text style={styles.label}>카테고리</Text>
      <View style={styles.categoryRow}>
        <Text style={styles.categoryValue}>{category?.name ?? '없음'}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={openCategoryModal}
          style={styles.categoryChangeButton}
        >
          <Text style={styles.categoryChangeLabel}>변경</Text>
        </Pressable>
      </View>

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
        <Text style={styles.addPurchaseButtonLabel}>구매 기록 추가</Text>
      </Pressable>

      <Text style={styles.label}>구매 기록</Text>
      {isLoadingPurchases ? (
        <ActivityIndicator style={styles.purchasesLoading} />
      ) : recentPurchases.length > 0 ? (
        recentPurchases.map(purchase => (
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
        ))
      ) : !purchasesError ? (
        <Text style={styles.purchasesEmpty}>구매 기록이 없습니다.</Text>
      ) : null}
      {purchasesError ? <Text style={styles.error}>{purchasesError}</Text> : null}

      <View style={styles.imagesHeaderRow}>
        <Text style={styles.label}>사진 ({images.length}/{MAX_ITEM_IMAGES})</Text>
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
                accessibilityLabel="사진 삭제"
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
            ? '업로드 중...'
            : images.length >= MAX_ITEM_IMAGES
              ? `사진은 최대 ${MAX_ITEM_IMAGES}장까지 추가할 수 있습니다`
              : '사진 추가'}
        </Text>
      </Pressable>

      {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {justSaved && !isDirty ? <Text style={styles.savedMessage}>저장되었습니다.</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !isDirty || isSaving, busy: isSaving }}
        disabled={!isDirty || isSaving}
        onPress={save}
        style={[styles.saveButton, (!isDirty || isSaving) && styles.disabledButton]}
      >
        <Text style={styles.saveButtonLabel}>{isSaving ? '저장 중...' : '저장'}</Text>
      </Pressable>

      <Text style={styles.label}>상태 관리</Text>
      <View style={styles.itemActionRow}>
        {item.state === 'inbox' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isItemActionInFlight }}
            disabled={isItemActionInFlight}
            onPress={moveToWishlistAction}
            style={[styles.itemActionButton, isItemActionInFlight && styles.disabledButton]}
          >
            <Text style={styles.itemActionButtonLabel}>위시리스트로</Text>
          </Pressable>
        ) : null}
        {item.state === 'archived' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isItemActionInFlight }}
            disabled={isItemActionInFlight}
            onPress={moveToWishlistAction}
            style={[styles.itemActionButton, isItemActionInFlight && styles.disabledButton]}
          >
            <Text style={styles.itemActionButtonLabel}>위시리스트로</Text>
          </Pressable>
        ) : null}
        {item.state === 'inbox' || item.state === 'wishlist' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isItemActionInFlight }}
            disabled={isItemActionInFlight}
            onPress={moveToArchiveAction}
            style={[styles.itemActionButton, isItemActionInFlight && styles.disabledButton]}
          >
            <Text style={styles.itemActionButtonLabel}>보관</Text>
          </Pressable>
        ) : null}
      </View>

      {itemActionError ? <Text style={styles.error}>{itemActionError}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isItemActionInFlight, busy: isDeletingItem }}
        disabled={isItemActionInFlight}
        onPress={confirmDeleteItem}
        style={[styles.itemDeleteButton, isItemActionInFlight && styles.disabledButton]}
      >
        <Text style={styles.itemDeleteButtonLabel}>
          {isDeletingItem ? '삭제 중...' : '삭제'}
        </Text>
      </Pressable>

      <Modal
        animationType="slide"
        onRequestClose={closeCategoryModal}
        transparent
        visible={isCategoryModalVisible}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {modalMode === 'select' ? (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>카테고리 선택</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCategoryActionInFlight}
                    onPress={openCategoryManage}
                  >
                    <Text style={styles.modalHeaderLinkLabel}>카테고리 관리</Text>
                  </Pressable>
                </View>

                {isLoadingCategoryOptions ? (
                  <ActivityIndicator style={styles.modalLoading} />
                ) : (
                  <FlatList
                    ListHeaderComponent={
                      <Pressable
                        accessibilityRole="button"
                        disabled={isCategoryActionInFlight}
                        onPress={() => selectCategory(null)}
                        style={[
                          styles.categoryOptionRow,
                          isCategoryActionInFlight && styles.disabledButton,
                        ]}
                      >
                        <Text style={styles.categoryOptionLabel}>카테고리 없음</Text>
                      </Pressable>
                    }
                    data={categoryOptions}
                    keyExtractor={option => option.id.toString()}
                    renderItem={({ item: option }) => (
                      <Pressable
                        accessibilityRole="button"
                        disabled={isCategoryActionInFlight}
                        onPress={() => selectCategory({ id: option.id, name: option.name })}
                        style={[
                          styles.categoryOptionRow,
                          isCategoryActionInFlight && styles.disabledButton,
                        ]}
                      >
                        <Text style={styles.categoryOptionLabel}>{option.name}</Text>
                      </Pressable>
                    )}
                    style={styles.categoryOptionList}
                  />
                )}

                {categoryModalError ? (
                  <Text style={styles.error}>{categoryModalError}</Text>
                ) : null}

                <Text style={styles.label}>새 카테고리</Text>
                <View style={styles.newCategoryRow}>
                  <TextInput
                    editable={!isCategoryActionInFlight}
                    onChangeText={setNewCategoryName}
                    placeholder="카테고리 이름"
                    style={styles.newCategoryInput}
                    value={newCategoryName}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: !newCategoryName.trim() || isCategoryActionInFlight,
                      busy: isCategoryActionInFlight,
                    }}
                    disabled={!newCategoryName.trim() || isCategoryActionInFlight}
                    onPress={submitNewCategory}
                    style={[
                      styles.newCategoryButton,
                      (!newCategoryName.trim() || isCategoryActionInFlight) &&
                        styles.disabledButton,
                    ]}
                  >
                    <Text style={styles.newCategoryButtonLabel}>생성</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>카테고리 관리</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isCategoryActionInFlight}
                    onPress={closeCategoryManage}
                  >
                    <Text style={styles.modalHeaderLinkLabel}>선택으로</Text>
                  </Pressable>
                </View>

                {categoryModalError ? (
                  <Text style={styles.error}>{categoryModalError}</Text>
                ) : null}

                <FlatList
                  data={categoryOptions}
                  keyExtractor={option => option.id.toString()}
                  ListEmptyComponent={
                    <Text style={styles.manageEmpty}>카테고리가 없습니다.</Text>
                  }
                  renderItem={({ item: option }) =>
                    renamingCategoryId === option.id ? (
                      <View style={styles.manageRow}>
                        <TextInput
                          autoFocus
                          editable={!isCategoryActionInFlight}
                          onChangeText={setRenameDraftName}
                          style={styles.renameInput}
                          value={renameDraftName}
                        />
                        <View style={styles.manageRowActions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isCategoryActionInFlight}
                            onPress={submitRename}
                            style={styles.manageActionButton}
                          >
                            <Text style={styles.manageActionLabel}>저장</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isCategoryActionInFlight}
                            onPress={cancelRename}
                            style={styles.manageActionButton}
                          >
                            <Text style={styles.manageActionLabel}>취소</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <View style={styles.manageRow}>
                        <Text numberOfLines={1} style={styles.categoryOptionLabel}>
                          {option.name}
                        </Text>
                        <View style={styles.manageRowActions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isCategoryActionInFlight}
                            onPress={() => startRename(option)}
                            style={styles.manageActionButton}
                          >
                            <Text style={styles.manageActionLabel}>이름변경</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            disabled={isCategoryActionInFlight}
                            onPress={() => confirmDeleteCategory(option)}
                            style={styles.manageActionButton}
                          >
                            <Text style={[styles.manageActionLabel, styles.manageDeleteLabel]}>
                              삭제
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )
                  }
                  style={styles.categoryOptionList}
                />
              </>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={isCategoryActionInFlight}
              onPress={closeCategoryModal}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseLabel}>닫기</Text>
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
  itemActionRow: {
    flexDirection: 'row',
  },
  itemActionButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    marginRight: 10,
    paddingVertical: 10,
  },
  itemActionButtonLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
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
    marginRight: 10,
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
  categoryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  categoryValue: {
    color: '#111111',
    fontSize: 15,
  },
  categoryChangeButton: {
    borderColor: '#9A9A9A',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  categoryChangeLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
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
  modalHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  modalHeaderLinkLabel: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  modalLoading: {
    marginVertical: 20,
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
    marginRight: 10,
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
  manageRow: {
    alignItems: 'center',
    borderTopColor: '#E0E0E0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  manageRowActions: {
    flexDirection: 'row',
  },
  manageActionButton: {
    marginLeft: 14,
  },
  manageActionLabel: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  manageDeleteLabel: {
    color: '#B42318',
  },
  renameInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    marginRight: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
