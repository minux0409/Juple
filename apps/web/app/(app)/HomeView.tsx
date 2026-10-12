'use client';

import { useEffect, useState } from 'react';
import { formatMessage } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import {
  HOME_VIEW_MODE_STORAGE_KEY,
  homeCountPath,
  homeHistoryPath,
  isSafeHttpUrl,
  parseHomeViewMode,
  toHomeLinkView,
  type HomeLinkView,
  type HomeViewMode,
  type ItemHistoryPage,
} from '../../lib/homeItems';
import { useSignedInApp } from './AppRoot';
import { Glyph } from './Glyph';
import { ViewModeToggle } from './ViewModeToggle';
import styles from './app.module.css';

type HomeState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'loaded'; readonly links: readonly HomeLinkView[]; readonly count: number | null; readonly day: Date };

function readStoredViewMode(): HomeViewMode {
  try {
    return parseHomeViewMode(window.localStorage.getItem(HOME_VIEW_MODE_STORAGE_KEY));
  } catch {
    return 'list';
  }
}

/**
 * Home (오늘 저장한 링크) - the mobile Home's reading side: today's links from GET /api/v1/items/history (newest first), the day and its
 * count (GET /api/v1/items/history/count, best effort like mobile), and the List / Grid / Image presentations. Saving, deleting and
 * the other per-link actions are not part of this Web round.
 */
export function HomeView() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<HomeState>({ kind: 'loading' });
  // Bumped by 다시 시도 to run the effect again.
  const [reloadToken, setReloadToken] = useState(0);
  // HomeView only mounts in the browser (after sign-in), so the stored preference can seed the first render.
  const [viewMode, setViewMode] = useState<HomeViewMode>(readStoredViewMode);

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
          setState({ kind: 'loaded', links: page.items.map(toHomeLinkView), count, day: now });
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

  const retry = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };

  const changeViewMode = (mode: HomeViewMode) => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(HOME_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private window, blocked site data): the choice simply lasts for this page.
    }
  };

  const timeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' });

  return (
    <section aria-busy={state.kind === 'loading'} className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{dictionary.homeTitle}</h1>
          {state.kind === 'loaded' ? (
            <p className={styles.pageSubtitle}>
              {formatMessage(dictionary.homeDateCount, { date: dateFormat.format(state.day), count: state.count ?? state.links.length })}
            </p>
          ) : null}
        </div>
        <ViewModeToggle
          groupLabel={dictionary.viewModeLabel}
          labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
          onChange={changeViewMode}
          value={viewMode}
        />
      </div>

      {state.kind === 'loading' ? <div aria-hidden className={styles.spinner} /> : null}
      {state.kind === 'failed' ? (
        <div className={styles.inlineState} role="alert">
          <p className={styles.stateTitle}>{dictionary.loadFailedTitle}</p>
          <p className={styles.stateMessage}>{dictionary.loadFailedMessage}</p>
          <button className={styles.secondaryButton} onClick={retry} type="button">
            {dictionary.retry}
          </button>
        </div>
      ) : null}
      {state.kind === 'loaded' && state.links.length === 0 ? <p className={styles.emptyState}>{dictionary.homeEmpty}</p> : null}
      {state.kind === 'loaded' && state.links.length > 0 ? (
        <ul className={viewMode === 'list' ? styles.linkList : viewMode === 'grid' ? styles.linkGrid : styles.imageGrid}>
          {state.links.map(link => (
            <li className={viewMode === 'image' ? styles.imageCell : styles.linkCard} key={link.id}>
              <LinkEntry
                lockedLabel={dictionary.lockedLink}
                link={link}
                mode={viewMode}
                savedAt={timeFormat.format(new Date(link.savedAtUtc))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Thumbnail({ link, className }: { readonly link: HomeLinkView; readonly className: string }) {
  return (
    <div aria-hidden className={className}>
      {link.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote link previews / short-lived read URLs, not optimizable assets
        <img alt="" loading="lazy" referrerPolicy="no-referrer" src={link.thumbnailUrl} />
      ) : (
        <span className={styles.thumbnailFallback}>{link.locked ? <Glyph name="Lock" size={22} /> : (link.site ?? '?').charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}

function LinkEntry({ link, mode, savedAt, lockedLabel }: { readonly link: HomeLinkView; readonly mode: HomeViewMode; readonly savedAt: string; readonly lockedLabel: string }) {
  const title = link.locked ? lockedLabel : link.title;
  const body =
    mode === 'image' ? (
      // Image view: only the picture (mobile SavedLinkImageTile) - the title stays available to screen readers and as a tooltip.
      <>
        <Thumbnail className={styles.imageTile} link={link} />
        <span className={styles.visuallyHidden}>{title}</span>
      </>
    ) : (
      <>
        <Thumbnail className={mode === 'grid' ? styles.cardImage : styles.thumbnail} link={link} />
        <div className={styles.linkText}>
          <span className={styles.linkTitle} dir="auto">{title}</span>
          <span className={styles.linkMeta}>
            {link.site ? <span dir="ltr">{link.site}</span> : null}
            {link.site ? ' · ' : null}
            <time dateTime={link.savedAtUtc}>{savedAt}</time>
          </span>
        </div>
      </>
    );
  const className = mode === 'list' ? styles.linkRowBody : mode === 'grid' ? styles.cardBody : styles.imageBody;

  return !link.locked && isSafeHttpUrl(link.url) ? (
    <a className={className} href={link.url} rel="noopener noreferrer" target="_blank" title={mode === 'image' ? title ?? undefined : undefined}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}
