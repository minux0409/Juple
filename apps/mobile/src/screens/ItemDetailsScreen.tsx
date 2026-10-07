import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  Linking,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  Pressable,
  View,
  useWindowDimensions,
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
import { SourceRow } from '../components/SourceRow';
import { formatSavedLinkTimestamp } from '../components/SavedLinkMetaRow';
import { ClockIcon } from '../icons/ClockIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { EditIcon } from '../icons/EditIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { ImageIcon } from '../icons/ImageIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { SiteIcon } from '../icons/SiteIcon';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { SheetHeader, useSheetDismissGesture } from '../components/sheetDismissGesture';
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
  type ItemReadContext,
} from '../items/api/itemsApi';
import { takeItemOpenGrant } from '../items/itemOpenGrant';
import type { RootStackParamList } from '../navigation/RootStack';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { isDefinitiveLoadError, LoadFailureState } from '../components/LoadFailureState';

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
  const { itemId, collectionContext, initialFocus, openContext } = route.params;
  const authenticatedRequest = useAuthenticatedApi();
  // Opened from a Home/Archive card gated by a Collection: every read of this link goes IN that Collection's context
  // with this opening's grant, taken once from the in-memory hand-off and kept only while this popup is open (closing it
  // drops it - the next tap asks for the password again). Never a context-free read of a gated link.
  const [readContext] = useState<ItemReadContext | null>(() =>
    openContext ? { collectionId: openContext.collectionId, unlockToken: takeItemOpenGrant(openContext.grantKey, openContext.collectionId) } : null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
  // The sheet's action row (Delete / Save) is measured, never guessed (its labels can wrap): a toast shows just above
  // it. With the keyboard open the row is under the keyboard (the sheet keeps its height), and the one toast host keeps
  // the toast right above the keyboard itself (see AppToast) - visible at once, and moving down (the same toast, the same
  // timer) when the keyboard closes.
  const [footerHeight, setFooterHeight] = useState(0);
  useToastBottomAnchor(insets.bottom + footerHeight);

  // Keyboard handling (see renderSheet): the sheet keeps its normal height and position, and when the keyboard opens it
  // moves up ONLY as far as the focused field needs - its bottom then sits KEYBOARD_FIELD_GAP above the keyboard - never
  // by the whole keyboard height, and never past a margin under the status bar; whatever is still needed after that is
  // scrolled inside the body. Measured in window coordinates (keyboard top, sheet, focused input), so a window that
  // resizes for the keyboard (older Android) and one that does not (edge-to-edge) come out the same.
  const isKeyboardVisibleRef = useRef(false);
  const keyboardTopRef = useRef<number | null>(null);
  // The overlay's height with the keyboard CLOSED, and the window width it was measured at: the sheet's place and size
  // come from this, never from the room left above an open keyboard (which crushed the sheet).
  const [stableArea, setStableArea] = useState<{ readonly height: number; readonly width: number } | null>(null);
  const [isMemoFocused, setIsMemoFocused] = useState(false);
  const sheetShiftY = useRef(new Animated.Value(0)).current;
  const sheetShiftRef = useRef(0);
  const overlayRef = useRef<ComponentRef<typeof View>>(null);
  const sheetRef = useRef<ComponentRef<typeof View>>(null);
  // This render's values for the (once-registered) keyboard handler.
  const sheetLayoutRef = useRef({ sheetTop: 0, safeTop: 0, isDialogOpen: false });

  // Opened from a comment notification: the comments are brought into view once - after they are
  // actually laid out (their position is measured, never guessed), so the screen never jumps early.
  const scrollRef = useRef<ScrollViewInstance>(null);
  const scrollYRef = useRef(0);
  const moveSheet = useCallback((shift: number) => {
    if (Math.abs(shift - sheetShiftRef.current) < 1) {
      return;
    }
    sheetShiftRef.current = shift;
    Animated.timing(sheetShiftY, { duration: SHEET_SHIFT_DURATION_MS, easing: Easing.out(Easing.cubic), toValue: -shift, useNativeDriver: true }).start();
  }, [sheetShiftY]);
  const keepFocusedFieldAboveKeyboard = useCallback(() => {
    const keyboardTop = keyboardTopRef.current;
    const { sheetTop, safeTop, isDialogOpen } = sheetLayoutRef.current;
    // Any of this sheet's editors (title, memo, the comment composer) - never one in a dialog above it.
    const input = TextInput.State.currentlyFocusedInput();
    const overlay = overlayRef.current;
    const sheet = sheetRef.current;
    if (keyboardTop === null || isDialogOpen || !input || !overlay || !sheet) {
      return;
    }
    overlay.measureInWindow((_overlayX, overlayY) => {
      sheet.measureInWindow((_sheetX, sheetY, _sheetWidth, sheetHeight) => {
        input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
          if (inputY < sheetY || inputY > sheetY + sheetHeight) {
            return;
          }
          // The field's bottom with the sheet at its normal place (both measurements carry the same current shift).
          const normalSheetTop = overlayY + sheetTop;
          const fieldBottom = normalSheetTop + (inputY - sheetY) + inputHeight;
          const { shift, remaining } = sheetKeyboardShift({ fieldBottom, keyboardTop, normalSheetTop, safeTop });
          moveSheet(shift);
          if (remaining > 0) {
            scrollRef.current?.scrollTo({ animated: true, y: scrollYRef.current + remaining });
          }
        });
      });
    });
  }, [moveSheet]);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, event => {
      isKeyboardVisibleRef.current = true;
      keyboardTopRef.current = event.endCoordinates.screenY;
      requestAnimationFrame(keepFocusedFieldAboveKeyboard);
    });
    const hide = Keyboard.addListener(hideEvent, () => {
      isKeyboardVisibleRef.current = false;
      keyboardTopRef.current = null;
      // Back to the normal place; the body keeps its scroll position.
      moveSheet(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keepFocusedFieldAboveKeyboard, moveSheet]);
  const onEditorFocus = () => requestAnimationFrame(keepFocusedFieldAboveKeyboard);
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

  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const loadDetails = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const details = await getItemDetails(authenticatedRequest, itemId, readContext);
      setItem(details);
      setTitle(details.title ?? '');
      setMemo(details.memo ?? '');
      setBaselineTitle(details.title ?? '');
      setBaselineMemo(details.memo ?? '');
    } catch (caughtError) {
      // In a locked Collection's context without a (still) valid grant: said as such - nothing of the link is shown.
      setError(contentGateOfError(caughtError) !== null ? t('collections.lockRequiredForAction') : getLoadErrorMessage(caughtError, t));
      setLoadFailure(caughtError);
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, itemId, readContext, t]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const loadImages = useCallback(async () => {
    setIsLoadingImages(true);
    setImagesError(null);
    try {
      const fetchedImages = await getItemImages(authenticatedRequest, itemId, readContext);
      setImages(fetchedImages);
    } catch (caughtError) {
      setImagesError(getImageListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingImages(false);
    }
  }, [authenticatedRequest, itemId, readContext, t]);

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

  // A bottom half-sheet over the screen it was opened from (the route is a transparent modal - see RootStack): rounded
  // top corners, a handle, 62% of the keyboard-closed room; long content scrolls INSIDE it. Its place and height come
  // from that keyboard-closed room and never change with the keyboard: an open keyboard covers its lower part, and the
  // sheet moves up only as much as the field being edited needs (see keepFocusedFieldAboveKeyboard). The handle is
  // visual only - X, a tap on the backdrop and the system back button close it.
  const close = () => navigation.goBack();
  // Dragging the sheet down is the same close as X / the backdrop / back: with unsaved edits it snaps back and the usual
  // "leave without saving?" question shows (the navigation guard), otherwise it slides away and the route closes. Its
  // offset is its own value, added to the entrance and the keyboard shift - none of the three overwrites another.
  const sheetGesture = useSheetDismissGesture({
    canDismiss: () => !(isDirty && !isDeleted),
    isStillOpen: () => navigation.isFocused?.() ?? false,
    onDismiss: close,
  });
  const roomHeight = stableArea?.height ?? windowHeight;
  const sheetHeight = Math.round((roomHeight - insets.top) * SHEET_INITIAL_HEIGHT_RATIO);
  const sheetTop = Math.max(roomHeight - sheetHeight, insets.top + spacing.lg);
  const sheetEnterY = useRef(new Animated.Value(sheetHeight)).current;
  sheetLayoutRef.current = {
    sheetTop,
    safeTop: insets.top + SHEET_SAFE_TOP_MARGIN,
    // A dialog over the sheet (the Collection picker, its create / password dialogs) has its own keyboard handling.
    isDialogOpen: categoryPicker.isVisible || categoryPicker.isCreateDialogVisible || categoryPicker.unlockTarget !== null,
  };
  const recordRoom = (height: number) => {
    // Only a keyboard-closed measurement sets the top. A smaller room at the same width without a reported keyboard
    // is the keyboard too (a window that resizes for it can lay out before the keyboard event) - also ignored.
    setStableArea(previous => {
      if (isKeyboardVisibleRef.current) {
        return previous;
      }
      if (previous && previous.width === windowWidth && height <= previous.height) {
        return previous;
      }
      return { height, width: windowWidth };
    });
  };
  useEffect(() => {
    Animated.timing(sheetEnterY, { duration: SHEET_ENTER_DURATION_MS, easing: Easing.out(Easing.cubic), toValue: 0, useNativeDriver: true }).start();
  }, [sheetEnterY]);

  const renderSheet = (body: ReactNode, footer?: ReactNode) => (
    <View ref={overlayRef} style={[styles.overlay, { paddingTop: sheetTop }]} testID="item-details-overlay">
      {/* The dim behind the sheet - it fades as the sheet is dragged away. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdropDim, { opacity: sheetGesture.backdropOpacity }]} />
      {/* The backdrop: tapping outside closes, like the system back button (unsaved edits are asked about first). */}
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no"
        onLayout={event => recordRoom(event.nativeEvent.layout.height)}
        onPress={close}
        style={StyleSheet.absoluteFill}
        testID="item-details-backdrop"
      />
      <Animated.View
        accessibilityViewIsModal
        ref={sheetRef}
        style={[
          styles.sheet,
          { height: sheetHeight, paddingBottom: insets.bottom, transform: [{ translateY: Animated.add(Animated.add(sheetEnterY, sheetShiftY), sheetGesture.dragY) }] },
        ]}
        testID="item-details-sheet"
      >
        {/* The shared sheet header: the handle over [icon 상세 ........ X] - one drag area, like every bottom sheet's. */}
        <SheetHeader
          actions={
            <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" hitSlop={4} onPress={close} style={styles.closeButton} testID="item-details-close">
              <CloseIcon color={colors.textSecondary} size={20} />
            </Pressable>
          }
          gesture={sheetGesture}
          icon={
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="item-details-header-icon">
              <LinkIcon color={colors.brand} size={18} />
            </View>
          }
          rowStyle={styles.header}
          testID="item-details-handle"
          title={<Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{t('nav.itemDetails')}</Text>}
        />
        {body}
        {footer}
      </Animated.View>
    </View>
  );

  if (isLoading && !item) {
    return renderSheet(
      <View style={styles.statusBody}>
        <ActivityIndicator testID="item-details-loading" />
      </View>,
    );
  }

  if (!item) {
    return renderSheet(
      <View style={styles.statusBody}>
        {error ? <LoadFailureState compact error={loadFailure} notice={isDefinitiveLoadError(loadFailure) ? error : null} onRetry={() => { loadDetails(); }} testID="item-details-load-error" /> : null}
      </View>,
    );
  }

  const thumbnailUrl = representativePhotoUrl(representativePhoto);
  const site = resolveSiteInfo(item.url);

  return (
    <>
      {renderSheet(
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          onScroll={event => {
            scrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
          ref={scrollRef}
          scrollEventThrottle={16}
          style={styles.body}
          testID="item-details-scroll"
        >
          {/* A. The link: a compact preview beside its (editable) title, the site, and opening it. */}
          <View style={styles.linkHeader} testID="item-details-preview">
            {thumbnailUrl ? (
              <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} testID="item-details-thumbnail" />
            ) : (
              <View style={[styles.thumbnail, styles.thumbnailFallback]} testID="item-details-thumbnail-fallback">
                {site.id ? <SiteIcon siteId={site.id} size={30} /> : <LinkIcon color={colors.brand} size={26} />}
              </View>
            )}
            <View style={styles.linkText}>
              <TextInput
                accessibilityLabel={t('item.titleLabel')}
                multiline
                onChangeText={setTitle}
                onFocus={onEditorFocus}
                placeholder={t('item.titlePlaceholder')}
                placeholderTextColor={colors.textSecondary}
                scrollEnabled
                style={styles.titleInput}
                testID="item-details-title"
                value={title}
              />
              <SourceRow
                trailing={
                  <Pressable accessibilityLabel={t('item.goToUrlA11y')} accessibilityRole="button" onPress={openOriginalUrl} style={styles.iconButton} testID="item-details-open-url">
                    <ExternalLinkIcon color={colors.brand} size={20} />
                  </Pressable>
                }
                url={item.url}
              />
            </View>
          </View>

          {/* B. The memo, as its own block. */}
          <View
            onLayout={() => {
              // The memo grew to its editing height (or its text wrapped): keep it above the keyboard.
              if (isMemoFocused) {
                onEditorFocus();
              }
            }}
            style={styles.memoBlock}
            testID="item-details-memo-block"
          >
            <View style={styles.blockTitleRow}>
              <EditIcon color={colors.textSecondary} size={15} />
              <Text style={styles.blockTitle}>{t('item.memo')}</Text>
            </View>
            <TextInput
              accessibilityLabel={t('item.memo')}
              multiline
              onBlur={() => setIsMemoFocused(false)}
              onChangeText={setMemo}
              onFocus={() => {
                setIsMemoFocused(true);
                onEditorFocus();
              }}
              placeholder={t('item.memoPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              scrollEnabled
              style={[styles.memoInput, isMemoFocused && styles.memoInputEditing]}
              testID="item-details-memo"
              value={memo}
            />
          </View>

          {/* C. What the link is filed under and when - one consistent row each: [icon] label ...... value. */}
          <View style={styles.infoRows}>
            <View style={styles.infoRow} testID="item-details-row-collections">
              <View style={styles.infoLabelColumn}>
                <FolderIcon color={colors.textSecondary} size={16} />
                <Text numberOfLines={1} style={styles.infoLabel}>{t('collections.itemSectionTitle')}</Text>
              </View>
              <View style={styles.infoValue}>
                <CategoryField
                  disabled={isSaving}
                  error={itemCollectionsError}
                  isLoading={isLoadingItemCollections}
                  onPress={categoryPicker.open}
                  selectedCollections={selectedCategories}
                  showLabel={false}
                />
              </View>
            </View>
            <View style={[styles.infoRow, styles.infoRowDivided]} testID="item-details-row-photo">
              <View style={styles.infoLabelColumn}>
                <ImageIcon color={colors.textSecondary} size={16} />
                <Text numberOfLines={1} style={styles.infoLabel}>{t('item.representativePhoto')}</Text>
              </View>
              <View style={styles.infoValue}>
                {isLoadingImages ? (
                  <ActivityIndicator style={styles.imagesLoading} />
                ) : (
                  <RepresentativePhotoField
                    compact
                    isBusy={isPhotoBusy}
                    isRemovable={representativePhoto?.kind === 'uploaded'}
                    onChoose={pickAndUploadImage}
                    onRemove={removePhoto}
                    photoUrl={thumbnailUrl}
                  />
                )}
              </View>
            </View>
            <View style={[styles.infoRow, styles.infoRowDivided]} testID="item-details-row-saved-at">
              <View style={styles.infoLabelColumn}>
                <ClockIcon color={colors.textSecondary} size={16} />
                <Text numberOfLines={1} style={styles.infoLabel}>{t('item.savedAtLabel')}</Text>
              </View>
              <Text numberOfLines={1} style={styles.infoValueText} testID="item-details-saved-at">{formatSavedLinkTimestamp(item.savedAtUtc, 'dateTime')}</Text>
            </View>
          </View>

          {imagesError ? <Text style={styles.error}>{imagesError}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {/* The Collection's reactions and comments on this link (only when opened from a shared Collection). */}
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
        </ScrollView>,
        // D. The actions, always at the sheet's bottom.
        <View onLayout={event => setFooterHeight(Math.round(event.nativeEvent.layout.height))} style={styles.footer} testID="item-details-footer">
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
            testID="item-details-save"
          >
            <Text numberOfLines={1} style={styles.saveActionLabel}>
              {isSaving ? t('common.saving') : t('common.save')}
            </Text>
          </Pressable>
        </View>,
      )}

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
        loadFailure={categoryPicker.loadFailure}
        onRetryLoad={categoryPicker.retryLoad}
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
        onUnlockStateChanged={categoryPicker.onUnlockStateChanged}
        selectedIds={selectedCategoryIds}
        unlockTarget={categoryPicker.unlockTarget}
        visible={categoryPicker.isVisible}
      />
    </>
  );
}

/** The sheet's starting height, as a share of the window below the status bar - a half-sheet, never a full page. */
const SHEET_INITIAL_HEIGHT_RATIO = 0.62;
/** The widest the sheet gets on a large screen (tablet / unfolded) - centered there. */
const SHEET_MAX_WIDTH = 640;
const SHEET_ENTER_DURATION_MS = 250;
/** The gap kept between the field being edited and the top of the keyboard. */
export const KEYBOARD_FIELD_GAP = 16;
/** The sheet's top never goes higher than this under the status bar / top inset while it moves for the keyboard. */
const SHEET_SAFE_TOP_MARGIN = 12;
const SHEET_SHIFT_DURATION_MS = 220;
/** While the memo is being edited it keeps at least a few lines of room - never a one-line strip. */
export const MEMO_EDITING_MIN_HEIGHT = 96;

/**
 * How far the sheet moves up for the keyboard: just enough for the focused field's bottom (at the sheet's normal place)
 * to sit KEYBOARD_FIELD_GAP above the keyboard's top - never the whole keyboard height - and never so far that the
 * sheet's top passes safeTop. What the clamp leaves is 'remaining', for the body to scroll. All in window coordinates.
 */
export function sheetKeyboardShift({ fieldBottom, keyboardTop, normalSheetTop, safeTop }: {
  readonly fieldBottom: number;
  readonly keyboardTop: number;
  readonly normalSheetTop: number;
  readonly safeTop: number;
}): { readonly shift: number; readonly remaining: number } {
  const required = Math.max(0, Math.round(fieldBottom + KEYBOARD_FIELD_GAP - keyboardTop));
  const maxShift = Math.max(0, Math.round(normalSheetTop - safeTop));
  const shift = Math.min(required, maxShift);
  return { shift, remaining: required - shift };
}
const THUMBNAIL_SIZE = 88;
/** The label side of an info row ([icon] 컬렉션 / 대표 사진 / 저장일). */
const INFO_LABEL_WIDTH = 104;
const TITLE_LINE_HEIGHT = 20;

const styles = StyleSheet.create({
  // The sheet sits at its keyboard-closed place (paddingTop) with its own height; the keyboard never resizes it.
  overlay: { flex: 1, justifyContent: 'flex-start' },
  backdropDim: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  sheet: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg + 6,
    borderTopRightRadius: radii.lg + 6,
    maxWidth: SHEET_MAX_WIDTH,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.inputBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingEnd: spacing.xs,
    paddingStart: spacing.lg,
  },
  headerTitle: { color: colors.textPrimary, flex: 1, fontSize: 17, fontWeight: '700' },
  closeButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  statusBody: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.lg },
  // Fills the sheet between the header and the actions, and scrolls when the content is longer.
  body: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.md },
  linkHeader: { flexDirection: 'row', gap: spacing.md },
  thumbnail: { borderRadius: radii.md + 4, height: THUMBNAIL_SIZE, width: THUMBNAIL_SIZE },
  thumbnailFallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  linkText: { flex: 1, minWidth: 0 },
  // At most three lines here (then it scrolls inside the field) - a long title never pushes everything else away.
  titleInput: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    lineHeight: TITLE_LINE_HEIGHT,
    maxHeight: TITLE_LINE_HEIGHT * 3 + spacing.sm,
    padding: 0,
    paddingVertical: spacing.xs,
    textAlignVertical: 'top',
  },
  // Icon-only, the full touch target around a compact icon (same treatment as the other row actions).
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  memoBlock: {
    backgroundColor: colors.background,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  blockTitleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  blockTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  // A long memo scrolls inside its own field; the field never grows past this.
  memoInput: {
    color: colors.textPrimary,
    fontSize: 15,
    maxHeight: 140,
    minHeight: 56,
    padding: 0,
    paddingVertical: spacing.xs,
    textAlignVertical: 'top',
  },
  memoInputEditing: { minHeight: MEMO_EDITING_MIN_HEIGHT },
  infoRows: { marginTop: spacing.md },
  infoRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget + 4, paddingVertical: spacing.xs },
  infoRowDivided: { borderTopColor: colors.inputBorder, borderTopWidth: StyleSheet.hairlineWidth },
  infoLabelColumn: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs + 2, width: INFO_LABEL_WIDTH },
  infoLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, fontWeight: '700' },
  infoValue: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
  infoValueText: { color: colors.textPrimary, flex: 1, fontSize: 14, textAlign: 'right' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.md },
  disabledButton: { opacity: 0.5 },
  footer: {
    borderTopColor: colors.inputBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  deleteActionLabel: { color: colors.danger, fontSize: 15, fontWeight: '700', paddingHorizontal: spacing.xs, textAlign: 'center' },
  saveActionButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md + 4,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
  },
  saveActionLabel: { color: colors.surface, fontSize: 15, fontWeight: '700' },
  imagesLoading: { marginVertical: spacing.sm },
});
