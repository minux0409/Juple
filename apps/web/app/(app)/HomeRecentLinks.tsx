'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../lib/authSession';
import { parseRecentLinks, recentLinksPath, recentLinkView, RECENT_LINKS_PATH } from '../../lib/recentLinks';
import type { LinkView, LinkViewMode } from '../../lib/savedLinks';
import { ConfirmDialog } from './ConfirmDialog';
import { useSignedInApp } from './AppRoot';
import { LoadFailed } from './PageStates';
import { SavedLinkList } from './SavedLinkList';
import { SavedLinkSkeleton } from './Skeletons';
import { useToast } from './Toaster';
import styles from './app.module.css';

type RecentState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly links: readonly LinkView[] };

/**
 * Home's 최근 조회한 링크: the links the person opened (their original page), newest first, from the server - the same card UI and the
 * same List / Grid / Image choice as 오늘 저장한 링크. Saved is not opened: nothing appears here until the person opens a link. Each card
 * opens the link's details. 기록 지우기 clears only this history (the links themselves stay). `reloadToken` re-reads after a link was opened.
 */
export function HomeRecentLinks({ mode, reloadToken, onOpenOriginal }: { readonly mode: LinkViewMode; readonly reloadToken: number; readonly onOpenOriginal: (link: LinkView) => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [state, setState] = useState<RecentState>({ kind: 'loading' });
  const [localToken, setLocalToken] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    api<unknown>({ path: recentLinksPath() }).then(
      raw => {
        if (ignore) {
          return;
        }
        const entries = parseRecentLinks(raw);
        setState(entries === null ? { kind: 'failed' } : { kind: 'loaded', links: entries.map(recentLinkView) });
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(current => (current.kind === 'loaded' ? current : { kind: 'failed' }));
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken, localToken]);

  const clear = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await api<void>({ method: 'DELETE', path: RECENT_LINKS_PATH });
      setState({ kind: 'loaded', links: [] });
      setConfirming(false);
    } catch (caught) {
      setConfirming(false);
      if (isSessionLost(caught)) {
        onSessionLost();
      } else {
        toast.showNotice(dictionary.homeRecentClearFailed, 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setState({ kind: 'loading' });
    setLocalToken(token => token + 1);
  };

  return (
    <section aria-labelledby="home-recent" className={styles.surfaceSection} data-home-recent>
      <div className={styles.sectionBar}>
        <h2 className={styles.sectionTitle} id="home-recent">
          {dictionary.homeRecentTitle}
        </h2>
        {state.kind === 'loaded' && state.links.length > 0 ? (
          <button className={styles.linkButton} onClick={() => setConfirming(true)} type="button">
            {dictionary.homeRecentClear}
          </button>
        ) : null}
      </div>
      {state.kind === 'loading' ? <SavedLinkSkeleton count={2} mode={mode} /> : null}
      {state.kind === 'failed' ? <LoadFailed dictionary={dictionary} onRetry={retry} /> : null}
      {state.kind === 'loaded' && state.links.length === 0 ? <p className={styles.emptyState}>{dictionary.homeRecentEmpty}</p> : null}
      {state.kind === 'loaded' && state.links.length > 0 ? <SavedLinkList dictionary={dictionary} links={state.links} mode={mode} onOpenOriginal={onOpenOriginal} /> : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.homeRecentClear}
        message={dictionary.homeRecentClearMessage}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void clear()}
        open={confirming}
        title={dictionary.homeRecentClearTitle}
      />
    </section>
  );
}
