'use client';

import { useEffect, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../lib/paging';
import { initialSectionKey, sectionLabel, sectionShowsDate, formatLinkTimestamp, type DateSection, type LinkView, type LinkViewMode } from '../../lib/savedLinks';
import { Glyph } from './Glyph';
import { LoadMore } from './InfiniteScroll';
import { LoadFailed } from './PageStates';
import { SavedLinkList } from './SavedLinkList';
import { SavedLinkSkeleton } from './Skeletons';
import styles from './app.module.css';

export interface SectionPage {
  readonly links: readonly LinkView[];
  readonly nextCursor: string | null;
}

type PageState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<LinkView>);

type SectionsState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly sections: readonly DateSection[] };

/** Skeleton count for a section's next page: its own size when small, else a screenful. */
function skeletonCount(section: DateSection, loaded: number): number {
  return Math.max(1, Math.min(6, section.count - loaded));
}

/**
 * The mobile date accordion (DateSectionList): the server's sections with their exact counts first - nothing of a section's links is
 * asked for until it is opened (오늘, else the first one, opens by itself once); an opened section loads its next page by itself as
 * its end comes near, with skeletons where the links will appear. What was loaded stays while the page is open, so closing and
 * reopening a section is instant.
 *
 * Mount it with a `key` per order: a different order starts over (a cursor is never carried into another order).
 */
export function DateSections({
  dictionary,
  locale,
  viewMode,
  loadSections,
  loadPage,
  reversed,
  emptyText,
  onBlocked,
  onSessionLost,
}: {
  readonly dictionary: AppDictionary;
  readonly locale: string;
  readonly viewMode: LinkViewMode;
  readonly loadSections: () => Promise<readonly DateSection[]>;
  readonly loadPage: (section: DateSection, cursor: string | null) => Promise<SectionPage>;
  /** ↑ oldest: the sections (and each one's pages) the other way round. */
  readonly reversed?: boolean;
  readonly emptyText: string;
  /** A definitive refusal the caller shows instead (a Collection lock): true = handled, nothing is shown here. */
  readonly onBlocked?: (error: unknown) => boolean;
  readonly onSessionLost: () => void;
}) {
  const [sectionsState, setSectionsState] = useState<SectionsState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pages, setPages] = useState<ReadonlyMap<string, PageState>>(new Map());
  const [reloadToken, setReloadToken] = useState(0);

  const setPage = (key: string, update: (previous: PageState | undefined) => PageState) =>
    setPages(previous => new Map(previous).set(key, update(previous.get(key))));

  const handleFailure = (error: unknown): boolean => {
    if (isSessionLost(error)) {
      onSessionLost();
      return true;
    }
    return onBlocked?.(error) === true;
  };

  const fetchFirstPage = (section: DateSection) => {
    setPage(section.key, () => ({ kind: 'loading' }));
    loadPage(section, null).then(
      page => setPage(section.key, () => ({ kind: 'loaded', ...firstPage(page.links, page.nextCursor) })),
      error => {
        if (!handleFailure(error)) {
          setPage(section.key, () => ({ kind: 'failed' }));
        }
      },
    );
  };

  useEffect(() => {
    let ignore = false;
    loadSections().then(
      loaded => {
        if (ignore) {
          return;
        }
        const ordered = reversed ? [...loaded].reverse() : loaded;
        setSectionsState({ kind: 'loaded', sections: ordered });
        // Opening the screen opens 오늘 (or the newest section) - once; after that the person's own choices stand.
        const first = initialSectionKey(loaded);
        const section = loaded.find(candidate => candidate.key === first);
        if (section) {
          setExpanded(new Set([section.key]));
          fetchFirstPage(section);
        }
      },
      error => {
        if (!ignore && !handleFailure(error)) {
          setSectionsState({ kind: 'failed' });
        }
      },
    );
    return () => {
      ignore = true;
    };
    // Loaded once per mount (and per 다시 시도); a new order remounts this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  const toggle = (section: DateSection) => {
    const isOpen = expanded.has(section.key);
    setExpanded(previous => {
      const next = new Set(previous);
      if (isOpen) {
        next.delete(section.key);
      } else {
        next.add(section.key);
      }
      return next;
    });
    const page = pages.get(section.key);
    if (!isOpen && (!page || page.kind === 'failed')) {
      fetchFirstPage(section);
    }
  };

  const loadMore = (section: DateSection) => {
    const page = pages.get(section.key);
    if (!page || page.kind !== 'loaded' || !canLoadMore(page)) {
      return;
    }
    setPage(section.key, previous => (previous?.kind === 'loaded' ? { kind: 'loaded', ...startLoadingMore(previous) } : previous ?? { kind: 'loading' }));
    loadPage(section, page.nextCursor).then(
      next =>
        setPage(section.key, previous =>
          previous?.kind === 'loaded' ? { kind: 'loaded', ...appendPage(previous, { items: next.links, nextCursor: next.nextCursor }, link => link.id) } : previous ?? { kind: 'loading' },
        ),
      error => {
        if (!handleFailure(error)) {
          setPage(section.key, previous => (previous?.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(previous) } : { kind: 'failed' }));
        }
      },
    );
  };

  if (sectionsState.kind === 'loading') {
    // The chosen view's shape (as 이름순's whole-Collection load shows it), not always the list.
    return <SavedLinkSkeleton count={4} mode={viewMode} />;
  }
  if (sectionsState.kind === 'failed') {
    return (
      <LoadFailed
        dictionary={dictionary}
        onRetry={() => {
          setSectionsState({ kind: 'loading' });
          setReloadToken(token => token + 1);
        }}
      />
    );
  }
  if (sectionsState.sections.length === 0) {
    return <p className={styles.emptyState}>{emptyText}</p>;
  }

  return (
    <div className={styles.sections}>
      {sectionsState.sections.map(section => {
        const isOpen = expanded.has(section.key);
        const page = pages.get(section.key);
        const withDate = sectionShowsDate(section.kind);
        return (
          <section className={styles.section} key={section.key}>
            <h2 className={styles.sectionHeading}>
              <button aria-expanded={isOpen} className={styles.sectionHeader} onClick={() => toggle(section)} type="button">
                <span className={styles.sectionLabel}>{sectionLabel(section, dictionary, locale)}</span>
                <span className={styles.sectionCount}>{formatMessage(dictionary.sectionCount, { count: section.count })}</span>
                <span aria-hidden className={isOpen ? styles.sectionChevronOpen : styles.sectionChevron}>
                  <Glyph name="Chevron" size={18} />
                </span>
              </button>
            </h2>
            {isOpen ? (
              <div aria-busy={!page || page.kind === 'loading'} className={styles.sectionBody}>
                {!page || page.kind === 'loading' ? <SavedLinkSkeleton count={skeletonCount(section, 0)} mode={viewMode} /> : null}
                {page?.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={() => fetchFirstPage(section)} /> : null}
                {page?.kind === 'loaded' ? (
                  <>
                    <SavedLinkList dictionary={dictionary} links={page.items} mode={viewMode} timestampOf={link => formatLinkTimestamp(link.timestampUtc, locale, withDate)} />
                    <LoadMore
                      dictionary={dictionary}
                      onLoadMore={() => loadMore(section)}
                      skeleton={<SavedLinkSkeleton count={skeletonCount(section, page.items.length)} mode={viewMode} />}
                      state={page}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
