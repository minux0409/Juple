import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Links per request inside one section - a screenful or two, never the whole section. */
export const DATE_SECTION_PAGE_SIZE = 25;

/** The servers' page limit - a refresh never asks for more rows than this in one request. */
const MAX_PAGE_LIMIT = 100;

/**
 * One date section as a server summary describes it (History's GET items/history/sections, a
 * Collection's GET collections/{id}/items/sections): identity, its [fromUtc, toUtc) window and the
 * exact number of links in it. No display text - see historySectionLabel.
 */
export interface DateSection {
  readonly key: string;
  readonly kind: 'today' | 'yesterday' | 'thisWeek' | 'month';
  readonly year: number | null;
  readonly month: number | null;
  readonly fromUtc: string;
  /** Null for 오늘 (open-ended). */
  readonly toUtc: string | null;
  readonly count: number;
}

/** One section's own loaded links and paging state. Absent (see pages) = never requested. */
export interface DateSectionPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  /** The first page is on its way (nothing to show yet - skeleton rows). */
  readonly isLoading: boolean;
  /** A next page is on its way (loaded rows stay, a few skeleton rows below them). */
  readonly isLoadingMore: boolean;
  readonly error: string | null;
}

/** Where a screen's sections and their pages come from - see useDateSectionPages. */
export interface DateSectionPagesSource<T> {
  readonly loadSections: () => Promise<readonly DateSection[]>;
  readonly loadPage: (section: DateSection, limit: number, cursor: string | undefined) => Promise<{ readonly items: readonly T[]; readonly nextCursor: string | null }>;
  readonly idOf: (item: T) => number;
  readonly errorMessage: (error: unknown) => string;
  /**
   * An error that ends the whole view rather than one request (a Collection that turned out to be
   * locked): return true to have every section and page dropped and no error text set - the caller
   * shows its own state instead.
   */
  readonly onBlockingError?: (error: unknown) => boolean;
  /** A summary load succeeded (e.g. a caller may now clear its own blocking state). */
  readonly onSectionsLoaded?: () => void;
}

export interface DateSectionPagesOptions {
  /** False: nothing is requested (on focus or otherwise) until it turns true. Default true. */
  readonly enabled?: boolean;
  /**
   * A change (e.g. the order the pages come in) drops every loaded page - the sections stay, and
   * expanded ones load their first page again through ensureLoaded.
   */
  readonly resetKey?: string;
}

export interface UseDateSectionPagesResult<T> {
  /** Every non-empty section with its exact total count, in the summary's order. */
  readonly sections: readonly DateSection[];
  readonly pages: ReadonlyMap<string, DateSectionPage<T>>;
  /** The very first summary is loading (nothing known yet). */
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  /** Loads a section's first page if it was never loaded (or failed) - a no-op otherwise. */
  readonly ensureLoaded: (key: string) => void;
  /** Loads a section's next page - a no-op while one is in flight, before the first page, or at its end. */
  readonly loadMore: (key: string) => void;
  /** Takes an already-removed link out of its section and lowers that section's count (an emptied section goes). */
  readonly removeItem: (itemId: number) => void;
}

/**
 * A date-grouped list as a summary plus independently paged sections. The summary is only section
 * identities and exact counts - no link data - so opening the list costs one small request however
 * many links there are. A section's links are fetched only when it is expanded,
 * DATE_SECTION_PAGE_SIZE at a time from its own server window with the server's keyset cursor -
 * never one request per link, and never a page of another section.
 *
 * Per section, a request token makes a newer request win over an older one still in flight, the
 * same cursor is never requested twice, and nothing lands after unmount. A collapsed section keeps
 * its loaded pages for this visit (reopening shows them at once); the screen unmounts their rows.
 *
 * Every focus after the first refreshes the summary. Sections that no longer exist lose their
 * pages; a section with loaded links that is expanded (isExpanded) reloads them in place - up to
 * the same number of rows, capped at the server's page limit - so edits made elsewhere show
 * without the list collapsing to its first page; a collapsed one just forgets them and loads again
 * when reopened.
 */
export function useDateSectionPages<T>(
  source: DateSectionPagesSource<T>,
  isExpanded: (key: string) => boolean,
  { enabled = true, resetKey = '' }: DateSectionPagesOptions = {},
): UseDateSectionPagesResult<T> {
  const [sections, setSections] = useState<readonly DateSection[]>([]);
  const [pages, setPages] = useState<ReadonlyMap<string, DateSectionPage<T>>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

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

  const updatePage = useCallback((key: string, update: (previous: DateSectionPage<T> | undefined) => DateSectionPage<T> | undefined) => {
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

  /** Forgets every loaded page and in-flight request (the sections themselves stay). */
  const dropAllPages = useCallback(() => {
    for (const key of new Set([...pagesRef.current.keys(), ...firstLoadInFlightRef.current])) {
      nextToken(key);
    }
    requestedCursorRef.current.clear();
    firstLoadInFlightRef.current.clear();
    pagesRef.current = new Map();
    setPages(new Map());
  }, []);

  /** The whole view is gone (e.g. locked): no section, page or error text stays. */
  const handleBlockingError = useCallback(
    (caughtError: unknown): boolean => {
      if (!sourceRef.current.onBlockingError?.(caughtError)) {
        return false;
      }
      summaryRequestRef.current++;
      dropAllPages();
      sectionsRef.current = [];
      setSections([]);
      setError(null);
      // Any summary still in flight is now stale and will not finish the loading state itself.
      setIsLoading(false);
      setIsRefreshing(false);
      return true;
    },
    [dropAllPages],
  );

  /** A section's first rows: `limit` of them, replacing what it had (in place when `keepRows`). */
  const loadFirst = useCallback(
    async (section: DateSection, limit: number, keepRows: boolean) => {
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
        const page = await sourceRef.current.loadPage(section, limit, undefined);
        if (isCurrent(section.key, token)) {
          updatePage(section.key, () => ({ items: page.items, nextCursor: page.nextCursor, isLoading: false, isLoadingMore: false, error: null }));
        }
      } catch (caughtError) {
        if (isCurrent(section.key, token) && !handleBlockingError(caughtError)) {
          updatePage(section.key, previous => ({
            items: previous?.items ?? [],
            nextCursor: previous?.nextCursor ?? null,
            isLoading: false,
            isLoadingMore: false,
            error: sourceRef.current.errorMessage(caughtError),
          }));
        }
      } finally {
        if (sectionTokenRef.current.get(section.key) === token) {
          firstLoadInFlightRef.current.delete(section.key);
        }
      }
    },
    [handleBlockingError, updatePage],
  );

  const ensureLoaded = useCallback(
    (key: string) => {
      const section = sectionsRef.current.find(entry => entry.key === key);
      const page = pagesRef.current.get(key);
      if (!enabledRef.current || !section || firstLoadInFlightRef.current.has(key) || (page && (page.isLoading || page.items.length > 0 || page.error === null))) {
        return;
      }
      loadFirst(section, DATE_SECTION_PAGE_SIZE, false);
    },
    [loadFirst],
  );

  const loadMore = useCallback(
    (key: string) => {
      const section = sectionsRef.current.find(entry => entry.key === key);
      const page = pagesRef.current.get(key);
      const cursor = page?.nextCursor;
      if (!enabledRef.current || !section || !page || !cursor || page.isLoading || page.isLoadingMore || requestedCursorRef.current.get(key) === cursor) {
        return;
      }
      const token = sectionTokenRef.current.get(key) ?? 0;
      requestedCursorRef.current.set(key, cursor);
      updatePage(key, previous => (previous ? { ...previous, isLoadingMore: true, error: null } : previous));
      sourceRef.current
        .loadPage(section, DATE_SECTION_PAGE_SIZE, cursor)
        .then(next => {
          if (!isCurrent(key, token)) {
            return;
          }
          const idOf = sourceRef.current.idOf;
          updatePage(key, previous => {
            const seen = new Set((previous?.items ?? []).map(idOf));
            return {
              items: [...(previous?.items ?? []), ...next.items.filter(item => !seen.has(idOf(item)))],
              nextCursor: next.nextCursor,
              isLoading: false,
              isLoadingMore: false,
              error: null,
            };
          });
        })
        .catch(caughtError => {
          if (!isCurrent(key, token) || handleBlockingError(caughtError)) {
            return;
          }
          // The same cursor may be tried again (on the next scroll).
          requestedCursorRef.current.delete(key);
          updatePage(key, previous => (previous ? { ...previous, isLoadingMore: false, error: sourceRef.current.errorMessage(caughtError) } : previous));
        });
    },
    [handleBlockingError, updatePage],
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
        const loaded = await sourceRef.current.loadSections();
        if (!isMountedRef.current || requestId !== summaryRequestRef.current) {
          return;
        }
        const previousByKey = new Map(sectionsRef.current.map(section => [section.key, section]));
        sectionsRef.current = loaded;
        setSections(loaded);
        sourceRef.current.onSectionsLoaded?.();

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
            loadFirst(section, Math.min(Math.max(page.items.length, DATE_SECTION_PAGE_SIZE), MAX_PAGE_LIMIT), true);
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
        if (isMountedRef.current && requestId === summaryRequestRef.current && !handleBlockingError(caughtError)) {
          // Whatever is already shown stays - only the error text changes.
          setError(sourceRef.current.errorMessage(caughtError));
        }
      } finally {
        if (isMountedRef.current && requestId === summaryRequestRef.current) {
          hasLoadedOnceRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [handleBlockingError, loadFirst],
  );

  useFocusEffect(
    useCallback(() => {
      if (enabledRef.current) {
        loadSummary(hasLoadedOnceRef.current ? 'refresh' : 'initial');
      }
    }, [loadSummary]),
  );

  // Turned on later (e.g. switching a Collection back to 시간순): load as a focus would.
  const previousEnabledRef = useRef(enabled);
  useEffect(() => {
    if (enabled && !previousEnabledRef.current) {
      loadSummary(hasLoadedOnceRef.current ? 'refresh' : 'initial');
    }
    previousEnabledRef.current = enabled;
  }, [enabled, loadSummary]);

  // A new page order: every loaded page is for the old one - the open sections start over.
  const previousResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (previousResetKeyRef.current === resetKey) {
      return;
    }
    previousResetKeyRef.current = resetKey;
    dropAllPages();
    if (enabledRef.current) {
      sectionsRef.current
        .filter(section => isExpandedRef.current(section.key))
        .forEach(section => loadFirst(section, DATE_SECTION_PAGE_SIZE, false));
    }
  }, [dropAllPages, loadFirst, resetKey]);

  const refresh = useCallback(() => {
    if (enabledRef.current) {
      loadSummary('refresh');
    }
  }, [loadSummary]);

  const removeItem = useCallback((itemId: number) => {
    const idOf = sourceRef.current.idOf;
    const owner = [...pagesRef.current.entries()].find(([, page]) => page.items.some(item => idOf(item) === itemId))?.[0];
    if (owner === undefined) {
      return;
    }
    setPages(previous => {
      const page = previous.get(owner);
      if (!page) {
        return previous;
      }
      const next = new Map(previous);
      next.set(owner, { ...page, items: page.items.filter(item => idOf(item) !== itemId) });
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
