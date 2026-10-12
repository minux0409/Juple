'use client';

import { useEffect, useState } from 'react';
import { ARCHIVE_SECTIONS_PATH, ARCHIVE_SORT_STORAGE_KEY, archiveNamePagePath, archiveSectionPagePath, parseArchiveSort } from '../../../lib/archiveView';
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
import { SortChips } from '../SortChips';
import { useStoredChoice } from '../useStoredChoice';
import { ViewModeToggle } from '../ViewModeToggle';
import styles from '../app.module.css';

/**
 * 보관함 - every link the person has saved, read the mobile way (DateHistoryScreen): 시간순 = the 오늘 / 어제 / 이번 주 / month sections,
 * 이름순 = the whole archive A-Z as one list; List / Grid / Image. Search, swipe actions, delete / share are not part of this Web round.
 */
export function ArchiveView() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [sort, setSort] = useStoredChoice(ARCHIVE_SORT_STORAGE_KEY, parseArchiveSort);
  const [viewMode, setViewMode] = useStoredChoice(VIEW_MODE_STORAGE_KEYS.archive, parseViewMode);

  return (
    <section className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{dictionary.navArchive}</h1>
        </div>
      </div>
      <div className={styles.toolbar}>
        <SortChips dictionary={dictionary} onPressName={() => setSort('name')} onPressTime={() => setSort('time')} sort={sort === 'name' ? 'title' : 'newest'} />
        <ViewModeToggle
          groupLabel={dictionary.viewModeLabel}
          labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
          onChange={setViewMode}
          value={viewMode}
        />
      </div>
      {sort === 'time' ? (
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
      ) : (
        <ArchiveByName api={api} dictionary={dictionary} key="name" locale={locale} onSessionLost={onSessionLost} viewMode={viewMode} />
      )}
    </section>
  );
}

function loadHistoryPage(api: AppApi, path: string): Promise<{ readonly links: readonly LinkView[]; readonly nextCursor: string | null }> {
  return api<ItemHistoryPage>({ path }).then(page => ({ links: page.items.map(historyLinkView), nextCursor: page.nextCursor }));
}

/** 이름순: the server's name order over the WHOLE archive, page by page as the list scrolls (never a sort of only the loaded rows). */
function ArchiveByName({
  api,
  dictionary,
  locale,
  viewMode,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  readonly locale: string;
  readonly viewMode: LinkViewMode;
  readonly onSessionLost: () => void;
}) {
  const [state, setState] = useState<{ readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<LinkView>)>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    loadHistoryPage(api, archiveNamePagePath(null)).then(
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
  }, [api, onSessionLost, reloadToken]);

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const cursor = state.nextCursor;
    setState({ kind: 'loaded', ...startLoadingMore(state) });
    loadHistoryPage(api, archiveNamePagePath(cursor)).then(
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
    return <p className={styles.emptyState}>{dictionary.archiveEmpty}</p>;
  }
  return (
    <>
      <SavedLinkList dictionary={dictionary} links={state.items} mode={viewMode} timestampOf={link => formatLinkTimestamp(link.timestampUtc, locale, true)} />
      <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SavedLinkSkeleton count={6} mode={viewMode} />} state={state} />
    </>
  );
}
