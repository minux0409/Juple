import { useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { useSortPreference } from '../settings/sortPreference';
import { addItemToCollections, getCollections, type AddItemToCollectionsResult, type Collection } from './api/collectionsApi';
import { contentGateOf } from './collectionAccess';
import { sortCollectionsByName } from './sortCollectionItems';

const PAGE_LIMIT = 50;
/** 이름순 loads every Collection first (see loadAll) - bounded, like a Collection's own 이름순. */
export const REPLICATE_NAME_ORDER_MAX_COLLECTIONS = 500;
const WHOLE_LIST_PAGE_LIMIT = 100;

export type ReplicatePickerSort = 'newest' | 'title';

export interface UseReplicateItemPickerResult {
  readonly isVisible: boolean;
  readonly open: (itemId: number) => void;
  readonly close: () => void;
  readonly collections: readonly Collection[];
  readonly isLoading: boolean;
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  readonly error: string | null;
  readonly sort: ReplicatePickerSort;
  readonly changeSort: (next: ReplicatePickerSort) => void;
  /** Collections the Item is already in (the one being looked at included) - shown, not choosable. */
  readonly containedIds: ReadonlySet<number>;
  readonly selectedIds: ReadonlySet<number>;
  readonly toggle: (collection: Collection) => void;
  readonly unlockTarget: Collection | null;
  readonly onUnlockGranted: (unlockToken: string) => void;
  readonly cancelUnlock: () => void;
  readonly isSubmitting: boolean;
  readonly submit: () => void;
}

function listErrorMessage(error: unknown, t: TFunction): string {
  return error instanceof ApiError && error.kind === 'unauthorized' ? t('errors.unauthorized') : t('collections.errorTargetLoadFallback');
}

function submitErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    if (error.code === 'collectionLocked') {
      // A grant expired between choosing and 복제 - choosing that Collection again asks for its password.
      return t('collections.lockRequiredForAction');
    }
  }
  return t('collections.replicateError');
}

/**
 * 다른 컬렉션에 복제: choose any number of the caller's OWN Collections for one Item and put it into all
 * of them in one request (addItemToCollections). Selection is kept by Collection id, so switching
 * List/Grid, the order or loading more never loses it. A Collection the Item is already in is shown
 * but cannot be chosen. A locked Collection asks for its own password when it is chosen - its grant is
 * sent with it; cancelling leaves it unchosen and nothing is sent. 최신순 is the server's own paged
 * order; 이름순 loads the whole list first (never a partial order presented as the whole).
 * A failed 복제 keeps the picker and the selection as they were, for another try.
 */
export function useReplicateItemPicker(
  authenticatedRequest: AuthenticatedApiRequest,
  t: TFunction,
  onReplicated: (result: AddItemToCollectionsResult) => void,
): UseReplicateItemPickerResult {
  const { sortOption, setSortOption } = useSortPreference('replicatePickerSort', 'newest');
  const sort: ReplicatePickerSort = sortOption === 'title' ? 'title' : 'newest';

  const [itemId, setItemId] = useState<number | null>(null);
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [containedIds, setContainedIds] = useState<ReadonlySet<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  // The grant for each locked Collection chosen in this picker session - sent with that Collection.
  const grantsRef = useRef(new Map<number, string>());
  const [unlockTarget, setUnlockTarget] = useState<Collection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  /** Every page of the caller's own Collections (optionally only those holding itemId), or null when over the limit. */
  const loadAll = async (filter: { readonly itemId?: number }): Promise<Collection[] | null> => {
    const all: Collection[] = [];
    let cursor: string | undefined;
    do {
      const page = await getCollections(authenticatedRequest, { ...filter, limit: WHOLE_LIST_PAGE_LIMIT, cursor });
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (all.length > REPLICATE_NAME_ORDER_MAX_COLLECTIONS || (cursor && all.length >= REPLICATE_NAME_ORDER_MAX_COLLECTIONS)) {
        return null;
      }
    } while (cursor);
    return all;
  };

  const loadList = async (order: ReplicatePickerSort) => {
    const generation = ++loadGenerationRef.current;
    setIsLoading(true);
    setError(null);
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
          setError(t('collections.replicateNameSortTooLarge', { max: REPLICATE_NAME_ORDER_MAX_COLLECTIONS }));
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
        setError(listErrorMessage(caughtError, t));
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  };

  const open = (targetItemId: number) => {
    setItemId(targetItemId);
    setSelectedIds(new Set());
    setContainedIds(new Set());
    grantsRef.current = new Map();
    setUnlockTarget(null);
    setCollections([]);
    setNextCursor(null);
    loadList(sort).catch(() => undefined);
    // Where the Item already is - a membership list, normally a handful of Collections.
    loadAll({ itemId: targetItemId })
      .then(contained => setContainedIds(new Set((contained ?? []).map(collection => collection.id))))
      .catch(() => undefined);
  };

  const close = () => {
    if (isSubmittingRef.current) {
      return;
    }
    loadGenerationRef.current += 1;
    setItemId(null);
    setUnlockTarget(null);
    setSelectedIds(new Set());
    grantsRef.current = new Map();
  };

  const changeSort = (next: ReplicatePickerSort) => {
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
      .catch(caughtError => setError(listErrorMessage(caughtError, t)))
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  };

  const select = (collectionId: number) => setSelectedIds(previous => new Set(previous).add(collectionId));

  const toggle = (collection: Collection) => {
    if (containedIds.has(collection.id) || isSubmittingRef.current) {
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
    if (contentGateOf(collection) !== null && !grantsRef.current.has(collection.id)) {
      setUnlockTarget(collection);
      return;
    }
    select(collection.id);
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
    if (itemId === null || selectedIds.size === 0 || isSubmittingRef.current) {
      return;
    }
    const collectionIds = [...selectedIds];
    const unlockTokens: Record<number, string> = {};
    collectionIds.forEach(collectionId => {
      const grant = grantsRef.current.get(collectionId);
      if (grant) {
        unlockTokens[collectionId] = grant;
      }
    });
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    addItemToCollections(authenticatedRequest, itemId, collectionIds, unlockTokens)
      .then(result => {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        close();
        onReplicated(result);
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
        setError(submitErrorMessage(caughtError, t));
      });
  };

  return {
    isVisible: itemId !== null,
    open,
    close,
    collections,
    isLoading,
    isLoadingMore,
    loadMore,
    error,
    sort,
    changeSort,
    containedIds,
    selectedIds,
    toggle,
    unlockTarget,
    onUnlockGranted,
    cancelUnlock,
    isSubmitting,
    submit,
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
