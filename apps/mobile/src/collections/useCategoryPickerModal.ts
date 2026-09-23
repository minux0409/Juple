import { useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import { createCollection, getCollections, type Collection } from './api/collectionsApi';
import type { CollectionColorValue } from './collectionColors';
import type { CollectionIconKey } from './collectionIcons';

const COLLECTION_OPTIONS_PAGE_LIMIT = 50;

function getListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorListFallback');
}

function getCreateErrorMessage(error: unknown, t: TFunction): string {
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

export interface UseCategoryPickerModalResult {
  readonly isVisible: boolean;
  readonly open: () => void;
  readonly close: () => void;
  readonly collectionPool: readonly Collection[];
  readonly isLoadingOptions: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  readonly error: string | null;
  readonly isCreateDialogVisible: boolean;
  readonly openCreateDialog: () => void;
  readonly closeCreateDialog: () => void;
  readonly isCreatingCollection: boolean;
  readonly createError: string | null;
  /** Returns true on success (the CategoryEditorDialog closes itself), false on failure (the
   * dialog stays open showing createError, matching this app's existing "let the user fix and
   * retry" pattern - see CategoryEditorDialog's own remarks). */
  readonly submitNewCollection: (name: string, icon: CollectionIconKey, color: CollectionColorValue) => Promise<boolean>;
}

/**
 * Everything the "카테고리 선택" bottom-sheet modal needs, shared verbatim by ItemDetailsScreen and
 * NewLinkReviewScreen (see CategoryPickerModal.tsx for the UI itself, and each screen's own
 * `onToggle`/selected-id state, which is the one thing that genuinely differs between them and so
 * stays screen-owned rather than living here). Extracted from ItemDetailsScreen's previous
 * inline implementation with no behavior change there - see this round's own "ItemDetails의 기존
 * staged category save 의미는 변경하지 않는다" requirement.
 *
 * `onCollectionCreated` is optional and only ever fires after a successful create - both current
 * callers (ItemDetailsScreen, NewLinkReviewScreen) pass one to auto-select the brand new category
 * for the Item being edited, per this round's "방금 만든 카테고리를 다시 찾아 누르게 하지 않는다"
 * requirement for CategoryPickerModal's own "+ 새 카테고리" create flow.
 */
export function useCategoryPickerModal(
  authenticatedRequest: AuthenticatedApiRequest,
  t: TFunction,
  onCollectionCreated?: (collection: Collection) => void,
): UseCategoryPickerModalResult {
  const [isVisible, setIsVisible] = useState(false);
  const [collectionPool, setCollectionPool] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateDialogVisible, setIsCreateDialogVisible] = useState(false);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const open = async () => {
    setIsVisible(true);
    setError(null);
    setIsLoadingOptions(true);
    try {
      // No itemId/excludeItemId here on purpose - this modal shows every Collection with a
      // selected/unselected toggle (driven by the caller's own selectedIds), which must reflect
      // the current *staged* selection, not a server-side filter the server has no notion of.
      const page = await getCollections(authenticatedRequest, { limit: COLLECTION_OPTIONS_PAGE_LIMIT });
      setCollectionPool(page.items);
      setNextCursor(page.nextCursor);
    } catch (caughtError) {
      setError(getListErrorMessage(caughtError, t));
    } finally {
      setIsLoadingOptions(false);
    }
  };

  const close = () => {
    if (isCreatingCollection) {
      return;
    }
    setIsVisible(false);
  };

  const openCreateDialog = () => {
    setCreateError(null);
    setIsCreateDialogVisible(true);
  };

  const closeCreateDialog = () => {
    if (isCreatingCollection) {
      return;
    }
    setIsCreateDialogVisible(false);
  };

  const loadMore = () => {
    if (loadingMoreRef.current || isLoadingOptions || !nextCursor) {
      return;
    }

    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    (async () => {
      try {
        const page = await getCollections(authenticatedRequest, {
          limit: COLLECTION_OPTIONS_PAGE_LIMIT,
          cursor: nextCursor,
        });
        setCollectionPool(previous => {
          const seenIds = new Set(previous.map(option => option.id));
          const additional = page.items.filter(option => !seenIds.has(option.id));
          return [...previous, ...additional];
        });
        setNextCursor(page.nextCursor);
      } catch (caughtError) {
        setError(getListErrorMessage(caughtError, t));
      } finally {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    })();
  };

  const submitNewCollection = async (
    name: string,
    icon: CollectionIconKey,
    color: CollectionColorValue,
  ): Promise<boolean> => {
    if (isCreatingCollection) {
      return false;
    }

    const validationError = getNameValidationError(name, t);
    if (validationError) {
      setCreateError(validationError);
      return false;
    }
    const trimmedName = name.trim();

    setIsCreatingCollection(true);
    setCreateError(null);
    try {
      const created = await createCollection(authenticatedRequest, trimmedName, icon, color);
      setCollectionPool(previous => [...previous, created]);
      setIsCreateDialogVisible(false);
      onCollectionCreated?.(created);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
      return true;
    } catch (caughtError) {
      setCreateError(getCreateErrorMessage(caughtError, t));
      return false;
    } finally {
      setIsCreatingCollection(false);
    }
  };

  return {
    isVisible,
    open,
    close,
    collectionPool,
    isLoadingOptions,
    isLoadingMore,
    loadMore,
    error,
    isCreateDialogVisible,
    openCreateDialog,
    closeCreateDialog,
    isCreatingCollection,
    createError,
    submitNewCollection,
  };
}
