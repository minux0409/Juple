'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useItemsChanged } from './useItemsChanged';
import { affectsList, removesFromList } from '../../lib/itemChanges';
import { formatMessage, type AppDictionary } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import type { CollectionSummary } from '../../lib/collectionsView';
import { homeCountPath, homeHistoryPath } from '../../lib/homeItems';
import { HOME_SUMMARY_PATH, parseHomeSummary } from '../../lib/homeSummary';
import { classifyCollectionShareUrl, collectionShareDestination } from '../../lib/collectionShareUrl';
import { normalizeEnteredUrl, openReview } from '../../lib/newLink';
import { collectionHref, formatLinkTimestamp, historyLinkView, parseViewMode, VIEW_MODE_STORAGE_KEYS, type ItemHistoryPage, type LinkView } from '../../lib/savedLinks';
import { useSignedInApp } from './AppRoot';
import { CollectionTileView } from './collections/CollectionsView';
import { CollectionGlyph, Glyph } from './Glyph';
import { LoadFailed } from './PageStates';
import { SavedLinkSkeleton } from './Skeletons';
import { SavedLinkList } from './SavedLinkList';
import { useStoredChoice } from './useStoredChoice';
import { ViewModeToggle } from './ViewModeToggle';
import { PageHeader } from './PageHeader';
import { LoadMore } from './InfiniteScroll';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../lib/paging';
import styles from './app.module.css';

type HomeState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | ({ readonly kind: 'loaded'; readonly count: number | null; readonly day: Date } & PagedState<LinkView>);

interface Summary {
  readonly all: number | null;
  readonly favorites: number | null;
  readonly shared: number | null;
  readonly favoriteShortcuts: readonly CollectionSummary[];
}

/**
 * Home - the place to start on the Web, built only from real data:
 *
 *  - the mobile Home input (it checks the text and opens 새 링크 검토 - nothing is saved there), as a large panel;
 *  - 오늘 저장한 링크 (GET /api/v1/items/history for today, newest first) in List / Grid / Image, each opening its page;
 *  - beside it on a wide window: exact counts only (see homeSummary.ts - a number that would be a guess is left out), the two
 *    existing destinations 새 컬렉션 / 보관함, and the favorite Collections as shortcuts.
 */
export function HomeView() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<HomeState>({ kind: 'loading' });
  // Bumped by 다시 시도 to run the effect again.
  const [reloadToken, setReloadToken] = useState(0);
  // A link was deleted / edited in the Quick Detail sheet over this page. A deletion takes the card (and one from today's count) away
  // at once, with nothing to click in between; an edit reads the list again, in place (no skeleton, same scroll).
  useItemsChanged(change => {
    const scope = { kind: 'personal' } as const;
    if (!affectsList(change, scope)) {
      return;
    }
    if (removesFromList(change, scope)) {
      setState(current => {
        if (current.kind !== 'loaded' || !current.items.some(link => link.id === change.itemId)) {
          return current;
        }
        return { ...current, items: current.items.filter(link => link.id !== change.itemId), count: current.count === null ? null : Math.max(0, current.count - 1) };
      });
      return;
    }
    setReloadToken(token => token + 1);
  });
  const [viewMode, setViewMode] = useStoredChoice(VIEW_MODE_STORAGE_KEYS.home, parseViewMode);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let ignore = false;
    // Recomputed per load: the page staying open across midnight shows the new day on the next load.
    const now = new Date();
    Promise.all([
      api<ItemHistoryPage>({ path: homeHistoryPath(now) }),
      // Best effort: without it the header shows how many are loaded.
      api<{ readonly count: number }>({ path: homeCountPath(now) }).then(result => result.count, () => null),
    ]).then(
      ([page, count]) => {
        if (!ignore) {
          const paged = firstPage(page.items.map(historyLinkView), page.nextCursor);
          setState({ kind: 'loaded', count, day: now, ...paged });
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
        // Network / server failure: still signed in - say so and offer a retry.
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken]);

  // The side summary is best effort: if it cannot be read Home just shows no numbers. ONE read gives the three exact counts and
  // the favorite shortcuts (it replaced three full Collection lists read in parallel at every Home visit).
  useEffect(() => {
    let ignore = false;
    api<unknown>({ path: HOME_SUMMARY_PATH }).then(
      raw => {
        if (!ignore) {
          setSummary(parseHomeSummary(raw));
        }
      },
      () => {
        if (!ignore) {
          setSummary(null);
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [api]);

  const retry = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state)) {
      return;
    }
    const cursor = state.nextCursor;
    const day = state.day;
    setState({ ...state, ...startLoadingMore(state) });
    api<ItemHistoryPage>({ path: homeHistoryPath(day, cursor) }).then(
      page => setState(current => {
        if (current.kind !== 'loaded') {
          return current;
        }
        const paged = appendPage(current, { items: page.items.map(historyLinkView), nextCursor: page.nextCursor }, link => link.id);
        return { ...current, ...paged };
      }),
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(current => current.kind === 'loaded'
          ? { ...current, ...failLoadingMore(current) }
          : current);
      },
    );
  };

  const dateFormat = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' });
  const todayCount = state.kind === 'loaded' ? (state.count ?? state.items.length) : null;

  return (
    <section aria-busy={state.kind === 'loading'} className={styles.page}>
      <PageHeader
        icon="Home"
        subtitle={state.kind === 'loaded' ? formatMessage(dictionary.homeDateCount, { date: dateFormat.format(state.day), count: todayCount ?? 0 }) : null}
        title={dictionary.homeTitle}
      />

      <AddLinkForm />

      <div className={styles.dashboard}>
        <div className={styles.dashboardMain}>

          <section aria-labelledby="home-today" className={styles.surfaceSection}>
            <div className={styles.sectionBar}>
              <h2 className={styles.sectionTitle} id="home-today">
                {dictionary.homeTitle}
              </h2>
              <ViewModeToggle
                groupLabel={dictionary.viewModeLabel}
                labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
                onChange={setViewMode}
                value={viewMode}
              />
            </div>
            {state.kind === 'loading' ? <SavedLinkSkeleton count={3} mode={viewMode} /> : null}
            {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
            {state.kind === 'loaded' && state.items.length === 0 ? <p className={styles.emptyState}>{dictionary.homeEmpty}</p> : null}
            {state.kind === 'loaded' && state.items.length > 0 ? (
              <>
                <SavedLinkList dictionary={dictionary} links={state.items} mode={viewMode} timestampOf={link => formatLinkTimestamp(link.timestampUtc, locale, false)} />
                <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<SavedLinkSkeleton count={3} mode={viewMode} />} state={state} />
              </>
            ) : null}
          </section>
        </div>

        <aside className={`${styles.dashboardSide} ${styles.railCard}`}>
          <SummaryCards dictionary={dictionary} summary={summary} todayCount={todayCount} />
          <div className={styles.quickActions}>
            <Link className={styles.quickAction} href="/collections/new">
              <Glyph name="Plus" size={18} />
              <span>{dictionary.collectionCreate}</span>
            </Link>
            <Link className={styles.quickAction} href="/archive">
              <Glyph name="Archive" size={18} />
              <span>{dictionary.navArchive}</span>
            </Link>
          </div>
          {summary && summary.favoriteShortcuts.length > 0 ? (
            <section aria-labelledby="home-favorites" className={styles.surfaceSection}>
              <div className={styles.sectionBar}>
                <h2 className={styles.sectionTitle} id="home-favorites">
                  {dictionary.filterFavorites}
                </h2>
                <Link className={styles.linkButton} href="/collections">
                  {dictionary.seeAll}
                </Link>
              </div>
              <ul className={styles.shortcutList}>
                {summary.favoriteShortcuts.map(collection => (
                  <li key={collection.id}>
                    <Link className={styles.shortcut} href={collectionHref(collection.id)}>
                      <CollectionTileView collection={collection} size={32} />
                      <span className={styles.shortcutName} dir="auto">
                        {collection.name}
                      </span>
                      <span className={styles.shortcutMeta}>{formatMessage(dictionary.itemCount, { count: collection.itemCount })}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

/** Only the numbers known exactly; a card whose number would be a guess is not shown at all. */
function SummaryCards({ summary, todayCount, dictionary }: { readonly summary: Summary | null; readonly todayCount: number | null; readonly dictionary: AppDictionary }) {
  const cards: { readonly key: string; readonly label: string; readonly value: number; readonly icon: React.ReactNode }[] = [];
  if (todayCount !== null) {
    cards.push({ key: 'today', label: dictionary.homeTitle, value: todayCount, icon: <Glyph name="Link" size={16} /> });
  }
  if (summary?.all != null) {
    cards.push({ key: 'all', label: dictionary.navCollections, value: summary.all, icon: <CollectionGlyph icon="Folder" size={16} /> });
  }
  if (summary?.favorites != null) {
    cards.push({ key: 'favorites', label: dictionary.filterFavorites, value: summary.favorites, icon: <Glyph name="Star" size={16} /> });
  }
  if (summary?.shared != null) {
    cards.push({ key: 'shared', label: dictionary.filterShared, value: summary.shared, icon: <Glyph name="People" size={16} /> });
  }
  if (cards.length === 0) {
    return null;
  }
  return (
    <dl className={styles.summaryGrid}>
      {cards.map(card => (
        <div className={styles.summaryCard} key={card.key}>
          <dt className={styles.summaryLabel}>
            <span aria-hidden className={styles.summaryIcon}>
              {card.icon}
            </span>
            {card.label}
          </dt>
          <dd className={styles.summaryValue}>{card.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The mobile Home URL field + 저장, as the page's main panel: checks the text (a bare http(s) URL, or the first one in pasted text) and opens the review. */
function AddLinkForm() {
  const { dictionary, publicWebHost } = useSignedInApp();
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      return;
    }
    const url = normalizeEnteredUrl(value);
    if (!url) {
      setError(dictionary.inboxErrorBadRequest);
      return;
    }
    setError(null);
    setValue('');
    // A Juple Collection share link (of ANY Juple environment) is never an ordinary link (the mobile Home): this environment's link opens
    // its Collection flow here (member, 추가 or 참가 요청); another environment's link goes to that environment, which decides itself.
    const shareLink = classifyCollectionShareUrl(url, publicWebHost);
    if (shareLink) {
      const destination = collectionShareDestination(shareLink);
      if (destination.kind === 'inApp') {
        router.push(destination.href);
      } else {
        window.location.assign(destination.url);
      }
      return;
    }
    // A full page navigation: see openReview (/items/new is never a Quick Detail sheet).
    openReview(url);
  };
  return (
    <form className={styles.addLinkPanel} noValidate onSubmit={submit}>
      <div className={styles.addLinkField}>
        <Glyph className={styles.addLinkIcon} name="Link" size={20} />
        <input
          aria-invalid={error ? true : undefined}
          aria-label={dictionary.urlPlaceholder}
          className={styles.addLinkInput}
          dir="ltr"
          inputMode="url"
          onChange={event => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder={dictionary.urlPlaceholder}
          type="text"
          value={value}
        />
        <button className={styles.primaryAction} disabled={!value.trim()} type="submit">
          {dictionary.save}
        </button>
      </div>
      {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
    </form>
  );
}
