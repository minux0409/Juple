'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useItemsChanged } from '../useItemsChanged';
import {
  ARCHIVE_SEARCH_DEBOUNCE_MS,
  ARCHIVE_SECTIONS_PATH,
  ARCHIVE_SORT_STORAGE_KEY,
  archiveFlatPagePath,
  archiveSectionPagePath,
  normalizeArchiveQuery,
  parseArchiveSort,
  type ArchiveSort,
} from '../../../lib/archiveView';
import type { AppDictionary } from '../../../lib/appI18n';
import type { AppApi } from '../../../lib/appApi';
import { isSessionLost } from '../../../lib/authSession';
import { formatLinkTimestamp, historyLinkView, parseViewMode, VIEW_MODE_STORAGE_KEYS, type DateSection, type ItemHistoryPage, type LinkView, type LinkViewMode } from '../../../lib/savedLinks';
import { useSignedInApp } from '../AppRoot';
import { DateSections } from '../DateSections';
import { LoadMore } from '../InfiniteScroll';
import { LoadFailed } from '../PageStates';
import { SavedLinkSkeleton } from '../Skeletons';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../lib/paging';
import { SavedLinkList } from '../SavedLinkList';
import { SearchField } from '../SearchField';
import { SortChips } from '../SortChips';
import { useStoredChoice } from '../useStoredChoice';
import { ViewModeToggle } from '../ViewModeToggle';
import { PageHeader } from '../PageHeader';
import styles from '../app.module.css';

/**
 * 보관함 - every link the person has saved, read the mobile way (DateHistoryScreen): 시간순 = the 오늘 / 어제 / 이번 주 / month sections,
 * 이름순 = the whole archive A-Z as one list; List / Grid / Image. 검색 (mobile useArchiveSearch) asks the server (`q`, 2+ characters,
 * debounced) over the WHOLE archive and shows the result as one flat list in the chosen order; clearing it returns to the sections.
 * The typed term lives in the address (?q=), so back / forward and a reload come back to the same search.
 */
export function ArchiveView() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [sort, setSort] = useStoredChoice(ARCHIVE_SORT_STORAGE_KEY, parseArchiveSort);
  const [viewMode, setViewMode] = useStoredChoice(VIEW_MODE_STORAGE_KEYS.archive, parseViewMode);
  const searchParams = useSearchParams();
  const [text, setText] = useState(() => searchParams.get('q') ?? '');
  const [term, setTerm] = useState<string | null>(() => normalizeArchiveQuery(searchParams.get('q') ?? ''));

  // Debounced: the term the server is asked for; the address keeps the typed text (replace - typing never fills the history).
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(normalizeArchiveQuery(text));
      const url = new URL(window.location.href);
      if (text.trim()) {
        url.searchParams.set('q', text.trim());
      } else {
        url.searchParams.delete('q');
      }
      window.history.replaceState(window.history.state, '', url);
    }, ARCHIVE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const tooShort = text.trim().length > 0 && normalizeArchiveQuery(text) === null;

  return (
    <section className={styles.page}>
      <PageHeader icon="Archive" title={dictionary.navArchive} />
      <div className={styles.searchBlock}>
        <div className={styles.archiveBar}>
          <SearchField onChange={setText} placeholder={dictionary.archiveSearchPlaceholder} value={text} />
          <div className={styles.archiveBarSwitches}>
            <SortChips dictionary={dictionary} onPressName={() => setSort('name')} onPressTime={() => setSort('time')} sort={sort === 'name' ? 'title' : 'newest'} />
            <ViewModeToggle
              groupLabel={dictionary.viewModeLabel}
              labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
              onChange={setViewMode}
              value={viewMode}
            />
          </div>
        </div>
        {tooShort ? <p className={styles.searchHint}>{dictionary.archiveSearchMinHint}</p> : null}
      </div>
      {term !== null || sort === 'name' ? (
        <ArchiveFlat api={api} dictionary={dictionary} key={`${sort}|${term ?? ''}`} locale={locale} onSessionLost={onSessionLost} sort={sort} term={term} viewMode={viewMode} />
      ) : (
        <DateSections
          dictionary={dictionary}
          emptyText={dictionary.archiveEmpty}
          key="time"
          loadPage={(section, cursor) => loadHistoryPage(api, archiveSectionPagePath(section, cursor))}
          loadSections={() => api<{ readonly sections: readonly DateSection[] }>({ path: ARCHIVE_SECTIONS_PATH }).then(result => result.sections)}
          locale={locale}
          onSessionLost={onSessionLost}
          viewMode={viewMode}
        />
      )}
    </section>
  );
}

function loadHistoryPage(api: AppApi, path: string): Promise<{ readonly links: readonly LinkView[]; readonly nextCursor: string | null }> {
  return api<ItemHistoryPage>({ path }).then(page => ({ links: page.items.map(historyLinkView), nextCursor: page.nextCursor }));
}

/**
 * The archive as ONE flat, server-paged list: 이름순 over the whole archive (never a sort of only the loaded rows) and / or a search.
 * Mounted with a key per term + order, so a different query starts over and an answer for an older one can never land on a newer
 * one (the effect's `ignore` flag is the sequence number).
 */
function ArchiveFlat({
  api,
  dictionary,
  locale,
  viewMode,
  sort,
  term,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  readonly locale: string;
  readonly viewMode: LinkViewMode;
  readonly sort: ArchiveSort;
  readonly term: string | null;
  readonly onSessionLost: () => void;
}) {
  const [state, setState] = useState<{ readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<LinkView>)>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  // A link was deleted / edited in the Quick Detail sheet over this page: read the list again, in place.
  useItemsChanged(() => setReloadToken(token => token + 1));

  useEffect(() => {
    let ignore = false;
    loadHistoryPage(api, archiveFlatPagePath({ term, sort, cursor: null })).then(
      page => {
        if (!ignore) {
          setState({ kind: 'loaded', ...firstPage(page.links, page.nextCursor) });
        }
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken, sort, term]);

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const cursor = state.nextCursor;
    setState({ kind: 'loaded', ...startLoadingMore(state) });
    loadHistoryPage(api, archiveFlatPagePath({ term, sort, cursor })).then(
      page => setState(current => (current.kind === 'loaded' ? { kind: 'loaded', ...appendPage(current, { items: page.links, nextCursor: page.nextCursor }, link => link.id) } : current)),
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(current => (current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current));
      },
    );
  };

  if (state.kind === 'loading') {
    return <SavedLinkSkeleton count={6} mode={viewMode} />;
  }
  if (state.kind === 'failed') {
    return (
      <LoadFailed
        dictionary={dictionary}
        onRetry={() => {
          setState({ kind: 'loading' });
          setReloadToken(token => token + 1);
        }}
      />
    );
  }
  if (state.items.length === 0) {
    return <p className={styles.emptyState}>{term !== null ? dictionary.searchEmpty : dictionary.archiveEmpty}</p>;
  }
  return (
    <>
      <SavedLinkList dictionary={dictionary} links={state.items} mode={viewMode} timestampOf={link => formatLinkTimestamp(link.timestampUtc, locale, true)} />
      <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SavedLinkSkeleton count={6} mode={viewMode} />} state={state} />
    </>
  );
}
