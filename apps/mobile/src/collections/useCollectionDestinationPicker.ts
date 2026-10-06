import { useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import type { LoadFailureInfo } from '../components/LoadFailureState';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { syncCategorySnapshotToNative } from '../categories/categorySnapshotSync';
import { useSortPreference } from '../settings/sortPreference';
import {
  createCollection,
  getCollections,
  type AddItemToCollectionsResult,
  type Collection,
} from './api/collectionsApi';
import { applyCollectionIconImageChange, KEEP_ICON_IMAGE, type CollectionIconImageChange } from './collectionIconImage';
import { contentGateOf } from './collectionAccess';
import { resolveFreshCollectionAccess, withFreshCollection } from './freshCollectionAccess';
import type { CollectionColorValue } from './collectionColors';
import type { CollectionIconKey } from './collectionIcons';
import { sortCollectionsByName } from './sortCollectionItems';

const PAGE_LIMIT = 50;
/** 이름순 loads every Collection first (see loadAll) - bounded, like a Collection's own 이름순. */
export const DESTINATION_NAME_ORDER_MAX_COLLECTIONS = 500;
const WHOLE_LIST_PAGE_LIMIT = 100;

export type DestinationPickerSort = 'newest' | 'title';

/** A chosen destination and the grant its lock (or share password) needed, if any - sent with it only. */
export interface PickedDestination {
  readonly collection: Collection;
  readonly unlockToken: string | null;
}

export interface DestinationPickerOptions {
  /** 복제 / 복사 choose any number of the caller's own Collections; 이동 exactly one. */
  readonly selection: 'multiple' | 'single';
  /**
   * Does the action for the chosen destinations. A rejection keeps the picker and the selection as
   * they were (errorMessage says why); a resolution closes it. Read at call time, so it may close
   * over the caller's current state.
   */
  readonly onSubmit: (destinations: readonly PickedDestination[]) => Promise<void>;
  readonly errorMessage: (error: unknown) => string;
}

export interface DestinationPickerOpenOptions {
  /** An Item of the caller's: the Collections it is already in are shown, but cannot be chosen. */
  readonly containedItemId?: number;
  /** More Collections shown but not choosable (e.g. the one a link is moved out of). */
  readonly disabledIds?: readonly number[];
}

export interface UseCollectionDestinationPickerResult {
  readonly isVisible: boolean;
  readonly open: (options?: DestinationPickerOpenOptions) => void;
  readonly close: () => void;
  readonly collections: readonly Collection[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  /** An action's error, or a note about the list (e.g. too many for name order) - never a failure to load it. */
  readonly error: string | null;
  /** The Collection list could not be loaded (first page, or a next page): shown as such, with a retry. */
  readonly loadFailure: LoadFailureInfo | null;
  /** Retries what failed: the first load when nothing is listed yet, else the next page. */
  readonly retryLoad: () => void;
  readonly sort: DestinationPickerSort;
  readonly changeSort: (next: DestinationPickerSort) => void;
  readonly disabledIds: ReadonlySet<number>;
  readonly selectedIds: ReadonlySet<number>;
  readonly toggle: (collection: Collection) => void;
  readonly unlockTarget: Collection | null;
  readonly onUnlockGranted: (unlockToken: string) => void;
  /** The prompt hit a state that no longer exists (the password was removed meanwhile): re-read, then go on. True when handled. */
  readonly onUnlockStateChanged: () => Promise<boolean>;
  readonly cancelUnlock: () => void;
  readonly isSubmitting: boolean;
  readonly submit: () => void;
  /** "+ 새 컬렉션 만들기": the editor dialog over the picker; the created Collection is chosen at once. */
  readonly isCreateDialogVisible: boolean;
  readonly openCreateDialog: () => void;
  readonly closeCreateDialog: () => void;
  readonly isCreating: boolean;
  readonly createError: string | null;
  readonly submitNewCollection: (
    name: string,
    icon: CollectionIconKey,
    color: CollectionColorValue,
    imageChange?: CollectionIconImageChange,
  ) => Promise<boolean>;
}

/** A failed LIST load: signed out is a definite state with its own sentence; anything else is the standard load failure. */
function listLoadFailure(error: unknown, t: TFunction): LoadFailureInfo {
  return { cause: error, notice: error instanceof ApiError && error.kind === 'unauthorized' ? t('errors.unauthorized') : null };
}

function createErrorMessage(error: unknown, t: TFunction): string {
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

/**
 * The one destination picker behind 다른 컬렉션에 복제, 내 컬렉션으로 복사 and 다른 컬렉션으로 이동: the
 * caller's OWN Collections (the server refuses any other destination anyway) with the same List/Grid,
 * 최신순/이름순, selected count and "+ 새 컬렉션 만들기" - only the action differs (see
 * DestinationPickerOptions). Selection is kept by Collection id, so switching List/Grid, the order or
 * loading more never loses it. A locked Collection asks for its own password when it is chosen - its
 * grant is sent with it; cancelling leaves it unchosen and nothing is sent. 최신순 is the server's
 * own paged order; 이름순 loads the whole list first (never a partial order presented as the whole).
 * A failed action keeps the picker and the selection as they were, for another try.
 */
export function useCollectionDestinationPicker(
  authenticatedRequest: AuthenticatedApiRequest,
  t: TFunction,
  options: DestinationPickerOptions,
): UseCollectionDestinationPickerResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { sortOption, setSortOption } = useSortPreference('replicatePickerSort', 'newest');
  const sort: DestinationPickerSort = sortOption === 'title' ? 'title' : 'newest';

  const [isVisible, setIsVisible] = useState(false);
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<LoadFailureInfo | null>(null);
  const [disabledIds, setDisabledIds] = useState<ReadonlySet<number>>(new Set());
  const fixedDisabledIdsRef = useRef<readonly number[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  // The grant for each locked Collection chosen in this picker session - sent with that Collection.
  const grantsRef = useRef(new Map<number, string>());
  const [unlockTarget, setUnlockTarget] = useState<Collection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  // Collections whose current state is being read right now: a second tap on one is the same tap.
  const resolvingIdsRef = useRef(new Set<number>());
  const [isCreateDialogVisible, setIsCreateDialogVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /** Every page of the caller's own Collections (optionally only those holding itemId), or null when over the limit. */
  const loadAll = async (filter: { readonly itemId?: number }): Promise<Collection[] | null> => {
    const all: Collection[] = [];
    let cursor: string | undefined;
    do {
      const page = await getCollections(authenticatedRequest, { ...filter, limit: WHOLE_LIST_PAGE_LIMIT, cursor });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (all.length > DESTINATION_NAME_ORDER_MAX_COLLECTIONS || (cursor && all.length >= DESTINATION_NAME_ORDER_MAX_COLLECTIONS)) {
        return null;
      }
    } while (cursor);
    return all;
  };

  const loadList = async (order: DestinationPickerSort) => {
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    setError(null);
    setLoadFailure(null);
    try {
      if (order === 'title') {
        const all = await loadAll({});
        if (generation !== loadGenerationRef.current) {
          return;
        }
        if (all === null) {
          // Too many to put in name order honestly - show the newest-first list instead, and say why.
          setSortOption('newest');
          await loadList('newest');
          setError(t('collections.replicateNameSortTooLarge', { max: DESTINATION_NAME_ORDER_MAX_COLLECTIONS }));
          return;
        }
        setCollections(sortCollectionsByName(all));
        setNextCursor(null);
      } else {
        const page = await getCollections(authenticatedRequest, { limit: PAGE_LIMIT });
        if (generation !== loadGenerationRef.current) {
          return;
        }
        setCollections(page.items);
        setNextCursor(page.nextCursor);
      }
    } catch (caughtError) {
      if (generation === loadGenerationRef.current) {
        setLoadFailure(listLoadFailure(caughtError, t));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  };

  const open = (openOptions: DestinationPickerOpenOptions = {}) => {
    fixedDisabledIdsRef.current = openOptions.disabledIds ?? [];
    setIsVisible(true);
    setSelectedIds(new Set());
    setDisabledIds(new Set(fixedDisabledIdsRef.current));
    grantsRef.current = new Map();
    setUnlockTarget(null);
    setIsCreateDialogVisible(false);
    setCollections([]);
    setNextCursor(null);
    loadList(sort).catch(() => undefined);
    if (openOptions.containedItemId !== undefined) {
      // Where the Item already is - a membership list, normally a handful of Collections.
      loadAll({ itemId: openOptions.containedItemId })
        .then(contained =>
          setDisabledIds(new Set([...fixedDisabledIdsRef.current, ...(contained ?? []).map(collection => collection.id)])),
        )
        .catch(() => undefined);
    }
  };

  const close = () => {
    if (isSubmittingRef.current || isCreating) {
      return;
    }
    loadGenerationRef.current += 1;
    setIsVisible(false);
    setUnlockTarget(null);
    setIsCreateDialogVisible(false);
    setSelectedIds(new Set());
    grantsRef.current = new Map();
  };

  const changeSort = (next: DestinationPickerSort) => {
    if (next === sort || isLoading) {
      return;
    }
    setSortOption(next);
    loadList(next).catch(() => undefined);
  };

  const loadMore = () => {
    if (sort !== 'newest' || !nextCursor || isLoading || loadingMoreRef.current) {
      return;
    }
    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadFailure(null);
    const generation = loadGenerationRef.current;
    getCollections(authenticatedRequest, { limit: PAGE_LIMIT, cursor: nextCursor })
      .then(page => {
        if (generation !== loadGenerationRef.current) {
          return;
        }
        setCollections(previous => {
          const seen = new Set(previous.map(collection => collection.id));
          return [...previous, ...page.items.filter(collection => !seen.has(collection.id))];
        });
        setNextCursor(page.nextCursor);
      })
      .catch(caughtError => setLoadFailure(listLoadFailure(caughtError, t)))
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  };

  /** Chooses it - and, for a single-destination picker, only it. */
  const select = (collectionId: number) =>
    setSelectedIds(previous => (optionsRef.current.selection === 'single' ? new Set([collectionId]) : new Set(previous).add(collectionId)));

  const toggle = (collection: Collection) => {
    if (disabledIds.has(collection.id) || isSubmittingRef.current) {
      return;
    }
    if (selectedIds.has(collection.id)) {
      // Unchoosing changes nothing on the server - no password needed.
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(collection.id);
        return next;
      });
      return;
    }
    if (resolvingIdsRef.current.has(collection.id)) {
      return;
    }
    // Whether it asks for a password is read from the server NOW, not trusted from the list loaded earlier.
    resolvingIdsRef.current.add(collection.id);
    resolveFreshCollectionAccess(authenticatedRequest, collection)
      .then(result => {
        if (result.status === 'unavailable') {
          setCollections(previous => previous.filter(entry => entry.id !== collection.id));
          setError(t('collections.pickerCollectionUnavailable'));
          return;
        }
        const current = result.status === 'ok' ? result.collection : collection;
        if (result.status === 'ok') {
          setCollections(previous => withFreshCollection(previous, current));
        }
        const gate = result.status === 'ok' ? result.gate : contentGateOf(collection);
        if (gate !== null && !grantsRef.current.has(collection.id)) {
          setUnlockTarget(current);
          return;
        }
        select(collection.id);
      })
      .catch(() => undefined)
      .finally(() => {
        resolvingIdsRef.current.delete(collection.id);
      });
  };

  const onUnlockStateChanged = async (): Promise<boolean> => {
    const target = unlockTarget;
    if (!target) {
      return true;
    }
    const result = await resolveFreshCollectionAccess(authenticatedRequest, target);
    if (result.status === 'unknown') {
      return false;
    }
    if (result.status === 'unavailable') {
      setUnlockTarget(null);
      setCollections(previous => previous.filter(entry => entry.id !== target.id));
      setError(t('collections.pickerCollectionUnavailable'));
      return true;
    }
    setCollections(previous => withFreshCollection(previous, result.collection));
    if (result.gate === null) {
      setUnlockTarget(null);
      select(target.id);
      return true;
    }
    setUnlockTarget(result.collection);
    return true;
  };

  const onUnlockGranted = (unlockToken: string) => {
    const target = unlockTarget;
    setUnlockTarget(null);
    if (target) {
      grantsRef.current.set(target.id, unlockToken);
      select(target.id);
    }
  };

  const cancelUnlock = () => setUnlockTarget(null);

  const submit = () => {
    if (selectedIds.size === 0 || isSubmittingRef.current) {
      return;
    }
    // In the order they were chosen (not the order of the list), so the request mirrors the choice.
    const byId = new Map(collections.map(collection => [collection.id, collection]));
    const destinations = [...selectedIds].flatMap(collectionId => {
      const collection = byId.get(collectionId);
      return collection ? [{ collection, unlockToken: grantsRef.current.get(collectionId) ?? null }] : [];
    });
    if (destinations.length === 0) {
      return;
    }
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    optionsRef.current
      .onSubmit(destinations)
      .then(() => {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        close();
      })
      .catch(caughtError => {
        if (caughtError instanceof ApiError && caughtError.code === 'collectionLocked') {
          // A grant ran out: unchoose the locked Collections, so choosing one again asks for its
          // password. Everything else stays chosen.
          const lockedIds = new Set(grantsRef.current.keys());
          grantsRef.current = new Map();
          setSelectedIds(previous => new Set([...previous].filter(collectionId => !lockedIds.has(collectionId))));
        }
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setError(optionsRef.current.errorMessage(caughtError));
      });
  };

  const openCreateDialog = () => {
    setCreateError(null);
    setIsCreateDialogVisible(true);
  };

  const closeCreateDialog = () => {
    if (!isCreating) {
      setIsCreateDialogVisible(false);
    }
  };

  const submitNewCollection = async (
    name: string,
    icon: CollectionIconKey,
    color: CollectionColorValue,
    imageChange: CollectionIconImageChange = KEEP_ICON_IMAGE,
  ): Promise<boolean> => {
    if (isCreating) {
      return false;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setCreateError(t('collections.errorNameRequired'));
      return false;
    }
    if (trimmedName.length > 100) {
      setCreateError(t('collections.errorNameTooLong'));
      return false;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      let created = await createCollection(authenticatedRequest, trimmedName, icon, color);
      // Created either way; a failed photo upload only leaves the built-in icon.
      created = await applyCollectionIconImageChange(authenticatedRequest, created, imageChange).catch(() => created);
      syncCategorySnapshotToNative(authenticatedRequest).catch(() => undefined);
      // At the top, already chosen - the user never has to find what they just made.
      setCollections(previous => [created, ...previous.filter(collection => collection.id !== created.id)]);
      select(created.id);
      setIsCreateDialogVisible(false);
      return true;
    } catch (caughtError) {
      setCreateError(createErrorMessage(caughtError, t));
      return false;
    } finally {
      setIsCreating(false);
    }
  };

  return {
    isVisible,
    open,
    close,
    collections,
    isLoading,
    isLoadingMore,
    loadMore,
    error,
    loadFailure,
    retryLoad: () => {
      if (collections.length === 0) {
        loadList(sort).catch(() => undefined);
      } else {
        loadMore();
      }
    },
    sort,
    changeSort,
    disabledIds,
    selectedIds,
    toggle,
    unlockTarget,
    onUnlockGranted,
    onUnlockStateChanged,
    cancelUnlock,
    isSubmitting,
    submit,
    isCreateDialogVisible,
    openCreateDialog,
    closeCreateDialog,
    isCreating,
    createError,
    submitNewCollection,
  };
}

/** The toast after 복제: all added / some already there / all already there. */
export function formatReplicateResultMessage(result: AddItemToCollectionsResult, t: TFunction): string {
  const total = result.addedCount + result.skippedCount;
  if (result.addedCount === 0) {
    return t('collections.replicateResultNone');
  }
  if (result.skippedCount === 0) {
    return t('collections.replicateResultAll', { count: result.addedCount });
  }
  return t('collections.replicateResultPartial', { total, added: result.addedCount, skipped: result.skippedCount });
}
