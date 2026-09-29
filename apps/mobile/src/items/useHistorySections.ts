import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getItemHistory, getItemHistorySections, type ItemHistoryEntry, type ItemHistorySection } from './api/itemsApi';

/** Links per request inside one section - a screenful or two, never the whole section. */
export const HISTORY_SECTION_PAGE_SIZE = 25;

/** The server's page limit - a refresh never asks for more rows than this in one request. */
const MAX_PAGE_LIMIT = 100;

/** One section's own loaded links and paging state. Absent (see pages) = never requested. */
export interface HistorySectionPage {
  readonly items: readonly ItemHistoryEntry[];
  readonly nextCursor: string | null;
  /** The first page is on its way (nothing to show yet - skeleton rows). */
  readonly isLoading: boolean;
  /** A next page is on its way (loaded rows stay, a few skeleton rows below them). */
  readonly isLoadingMore: boolean;
  readonly error: string | null;
}

export interface UseHistorySectionsResult {
  /** Every non-empty section with its exact total count, newest first. */
  readonly sections: readonly ItemHistorySection[];
  readonly pages: ReadonlyMap<string, HistorySectionPage>;
  /** The very first summary is loading (nothing known yet). */
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  /** Loads a section's first page if it was never loaded (or failed) - a no-op otherwise. */
  readonly ensureLoaded: (key: string) => void;
  /** Loads a section's next page - a no-op while one is in flight, before the first page, or at its end. */
  readonly loadMore: (key: string) => void;
  /** Takes an already-deleted Item out of its section and lowers that section's count (an emptied section goes). */
  readonly removeItem: (itemId: number) => void;
}

function errorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      return t('errors.accountNotReady');
    }
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
  }
  return t('history.errorLoadFallback');
}

/**
 * History as a summary plus independently paged sections. The summary (GET history/sections) is
 * only section identities and exact counts - no link data - so opening History costs one small
 * request however many links there are. A section's links are fetched only when it is expanded,
 * HISTORY_SECTION_PAGE_SIZE at a time from its own server window with the same (SavedAtUtc, Id)
 * cursor as before - never one request per link, and never a page of another section.
 *
 * Per section, a request token makes a newer request win over an older one still in flight, the
 * same cursor is never requested twice, and nothing lands after unmount. A collapsed section keeps
 * its loaded pages for this visit (reopening shows them at once); the screen unmounts their rows.
 *
 * Every focus after the first refreshes the summary. Sections that no longer exist lose their
 * pages; a section with loaded links that is expanded (isExpanded) reloads them in place - up to
 * the same number of rows, capped at the server's page limit - so edits made in ItemDetails show
 * without the list collapsing to its first page; a collapsed one just forgets them and loads again
 * when reopened.
 */
export function useHistorySections(isExpanded: (key: string) => boolean): UseHistorySectionsResult {
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();
  const [sections, setSections] = useState<readonly ItemHistorySection[]>([]);
  const [pages, setPages] = useState<ReadonlyMap<string, HistorySectionPage>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;

  const summaryRequestRef = useRef(0);
  const sectionTokenRef = useRef(new Map<string, number>());
  const requestedCursorRef = useRef(new Map<string, string>());
  // Sections whose first page is on its way right now - read synchronously, so two calls in the
  // same tick (before state re-renders) never request the same first page twice.
  const firstLoadInFlightRef = useRef(new Set<string>());
  const hasLoadedOnceRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updatePage = useCallback((key: string, update: (previous: HistorySectionPage | undefined) => HistorySectionPage | undefined) => {
    setPages(previous => {
      const next = new Map(previous);
      const value = update(previous.get(key));
      if (value === undefined) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
  }, []);

  /** Starts a new request for a section; any older one of it still in flight is ignored when it lands. */
  const nextToken = (key: string) => {
    const token = (sectionTokenRef.current.get(key) ?? 0) + 1;
    sectionTokenRef.current.set(key, token);
    return token;
  };
  const isCurrent = (key: string, token: number) => isMountedRef.current && sectionTokenRef.current.get(key) === token;

  /** A section's first rows: `limit` of them, replacing what it had (in place when `keepRows`). */
  const loadFirst = useCallback(
    async (section: ItemHistorySection, limit: number, keepRows: boolean) => {
      const token = nextToken(section.key);
      requestedCursorRef.current.delete(section.key);
      firstLoadInFlightRef.current.add(section.key);
      updatePage(section.key, previous => ({
        items: keepRows ? previous?.items ?? [] : [],
        nextCursor: keepRows ? previous?.nextCursor ?? null : null,
        isLoading: !keepRows || !previous,
        isLoadingMore: false,
        error: null,
      }));
      try {
        const page = await getItemHistory(authenticatedRequest, { limit, fromUtc: section.fromUtc, toUtc: section.toUtc });
        if (isCurrent(section.key, token)) {
          updatePage(section.key, () => ({ items: page.items, nextCursor: page.nextCursor, isLoading: false, isLoadingMore: false, error: null }));
        }
      } catch (caughtError) {
        if (isCurrent(section.key, token)) {
          updatePage(section.key, previous => ({
            items: previous?.items ?? [],
            nextCursor: previous?.nextCursor ?? null,
            isLoading: false,
            isLoadingMore: false,
            error: errorMessage(caughtError, t),
          }));
        }
      } finally {
        if (sectionTokenRef.current.get(section.key) === token) {
          firstLoadInFlightRef.current.delete(section.key);
        }
      }
    },
    [authenticatedRequest, t, updatePage],
  );

  const ensureLoaded = useCallback(
    (key: string) => {
      const section = sectionsRef.current.find(entry => entry.key === key);
      const page = pagesRef.current.get(key);
      if (!section || firstLoadInFlightRef.current.has(key) || (page && (page.isLoading || page.items.length > 0 || page.error === null))) {
        return;
      }
      loadFirst(section, HISTORY_SECTION_PAGE_SIZE, false);
    },
    [loadFirst],
  );

  const loadMore = useCallback(
    (key: string) => {
      const section = sectionsRef.current.find(entry => entry.key === key);
      const page = pagesRef.current.get(key);
      const cursor = page?.nextCursor;
      if (!section || !page || !cursor || page.isLoading || page.isLoadingMore || requestedCursorRef.current.get(key) === cursor) {
        return;
      }
      const token = sectionTokenRef.current.get(key) ?? 0;
      requestedCursorRef.current.set(key, cursor);
      updatePage(key, previous => (previous ? { ...previous, isLoadingMore: true, error: null } : previous));
      getItemHistory(authenticatedRequest, { limit: HISTORY_SECTION_PAGE_SIZE, cursor, fromUtc: section.fromUtc, toUtc: section.toUtc })
        .then(next => {
          if (!isCurrent(key, token)) {
            return;
          }
          updatePage(key, previous => {
            const seen = new Set((previous?.items ?? []).map(item => item.id));
            return {
              items: [...(previous?.items ?? []), ...next.items.filter(item => !seen.has(item.id))],
              nextCursor: next.nextCursor,
              isLoading: false,
              isLoadingMore: false,
              error: null,
            };
          });
        })
        .catch(caughtError => {
          if (!isCurrent(key, token)) {
            return;
          }
          // The same cursor may be tried again (on the next scroll).
          requestedCursorRef.current.delete(key);
          updatePage(key, previous => (previous ? { ...previous, isLoadingMore: false, error: errorMessage(caughtError, t) } : previous));
        });
    },
    [authenticatedRequest, t, updatePage],
  );

  const loadSummary = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const requestId = ++summaryRequestRef.current;
      if (mode === 'refresh') {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      try {
        const loaded = await getItemHistorySections(authenticatedRequest);
        if (!isMountedRef.current || requestId !== summaryRequestRef.current) {
          return;
        }
        const previousByKey = new Map(sectionsRef.current.map(section => [section.key, section]));
        sectionsRef.current = loaded;
        setSections(loaded);

        const loadedKeys = new Set(loaded.map(section => section.key));
        const stale: string[] = [];
        for (const key of pagesRef.current.keys()) {
          if (!loadedKeys.has(key)) {
            stale.push(key);
          }
        }
        for (const section of loaded) {
          const page = pagesRef.current.get(section.key);
          const previous = previousByKey.get(section.key);
          if (!page) {
            continue;
          }
          const sameWindow = previous !== undefined && previous.fromUtc === section.fromUtc && previous.toUtc === section.toUtc;
          if (sameWindow && isExpandedRef.current(section.key)) {
            // Reload what is shown, in place (edits made elsewhere appear; no jump back to the top).
            loadFirst(section, Math.min(Math.max(page.items.length, HISTORY_SECTION_PAGE_SIZE), MAX_PAGE_LIMIT), true);
          } else {
            stale.push(section.key);
          }
        }
        for (const key of stale) {
          nextToken(key);
          requestedCursorRef.current.delete(key);
          firstLoadInFlightRef.current.delete(key);
        }
        if (stale.length > 0) {
          setPages(previous => {
            const next = new Map(previous);
            stale.forEach(key => next.delete(key));
            return next;
          });
        }
      } catch (caughtError) {
        if (isMountedRef.current && requestId === summaryRequestRef.current) {
          // Whatever is already shown stays - only the error text changes.
          setError(errorMessage(caughtError, t));
        }
      } finally {
        if (isMountedRef.current && requestId === summaryRequestRef.current) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [authenticatedRequest, loadFirst, t],
  );

  useFocusEffect(
    useCallback(() => {
      loadSummary(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }, [loadSummary]),
  );

  const refresh = useCallback(() => {
    loadSummary('refresh');
  }, [loadSummary]);

  const removeItem = useCallback((itemId: number) => {
    const owner = [...pagesRef.current.entries()].find(([, page]) => page.items.some(item => item.id === itemId))?.[0];
    if (owner === undefined) {
      return;
    }
    setPages(previous => {
      const page = previous.get(owner);
      if (!page) {
        return previous;
      }
      const next = new Map(previous);
      next.set(owner, { ...page, items: page.items.filter(item => item.id !== itemId) });
      return next;
    });
    setSections(previous => {
      const next = previous
        .map(section => (section.key === owner ? { ...section, count: Math.max(0, section.count - 1) } : section))
        .filter(section => section.count > 0);
      sectionsRef.current = next;
      return next;
    });
  }, []);

  return { sections, pages, isLoading, isRefreshing, error, refresh, ensureLoaded, loadMore, removeItem };
}
