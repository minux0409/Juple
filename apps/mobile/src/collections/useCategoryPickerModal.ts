import { useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import { createCollection, getCollections, type Collection } from './api/collectionsApi';

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
  readonly newCollectionName: string;
  readonly setNewCollectionName: (value: string) => void;
  readonly isCreatingCollection: boolean;
  readonly submitNewCollection: () => Promise<void>;
}

/**
 * Everything the "카테고리 선택" bottom-sheet modal needs, shared verbatim by ItemDetailsScreen and
 * NewLinkReviewScreen (see CategoryPickerModal.tsx for the UI itself, and each screen's own
 * `onToggle`/selected-id state, which is the one thing that genuinely differs between them and so
 * stays screen-owned rather than living here). Extracted from ItemDetailsScreen's previous
 * inline implementation with no behavior change there - see this round's own "ItemDetails의 기존
 * staged category save 의미는 변경하지 않는다" requirement.
 *
 * `onCollectionCreated` is optional and only ever fires after a successful create - ItemDetails
 * omits it (creating a category there has never auto-selected it for the current Item, and still
 * doesn't), while NewLinkReviewScreen passes one to auto-select the brand new category, per this
 * round's explicit requirement for that screen.
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
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);

  const open = async () => {
    setIsVisible(true);
    setError(null);
    setNewCollectionName('');
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

  const submitNewCollection = async () => {
    if (isCreatingCollection) {
      return;
    }

    const validationError = getNameValidationError(newCollectionName, t);
    if (validationError) {
      setError(validationError);
      return;
    }
    const trimmedName = newCollectionName.trim();

    setIsCreatingCollection(true);
    setError(null);
    try {
      const created = await createCollection(authenticatedRequest, trimmedName);
      setCollectionPool(previous => [...previous, created]);
      setNewCollectionName('');
      onCollectionCreated?.(created);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
    } catch (caughtError) {
      setError(getCreateErrorMessage(caughtError, t));
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
    newCollectionName,
    setNewCollectionName,
    isCreatingCollection,
    submitNewCollection,
  };
}
