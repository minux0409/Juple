'use client';

import { useEffect, useRef } from 'react';
import type { AppDictionary } from '../../lib/appI18n';
import { pageLoadStep, type PagedState } from '../../lib/paging';
import styles from './app.module.css';

/**
 * The end of a paged list (the mobile lists' onEndReached + skeleton rows): an invisible sentinel a little below the last item; when
 * it comes near the viewport the next page is asked for - once (the state says a page is on its way, so a second request never
 * starts), with skeletons where the items will appear. A failed page shows a retry and is never retried by itself. The last page
 * removes the sentinel. What is loaded always stays.
 */
export function LoadMore<T>({
  state,
  onLoadMore,
  skeleton,
  dictionary,
}: {
  readonly state: PagedState<T>;
  readonly onLoadMore: () => void;
  /** Placeholders shaped like the list's own items. */
  readonly skeleton: React.ReactNode;
  readonly dictionary: AppDictionary;
}) {
  const step = pageLoadStep(state);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);
  useEffect(() => {
    loadRef.current = onLoadMore;
  });

  useEffect(() => {
    const element = sentinel.current;
    if (step !== 'idle' || !element || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    // A new observer per "ready for the next page" state: it reports the current intersection at once, so a page that still leaves
    // the sentinel on screen (a tall window, dense Image tiles) asks for the next one without waiting for a scroll.
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer.disconnect();
          loadRef.current();
        }
      },
      { rootMargin: '0px 0px 600px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [step, state.items.length]);

  if (step === 'loading') {
    return <div aria-busy>{skeleton}</div>;
  }
  if (step === 'failed') {
    return (
      <div className={styles.loadMoreRow} role="alert">
        <span className={styles.stateMessage}>{dictionary.loadFailedTitle}</span>
        <button className={styles.secondaryButton} onClick={onLoadMore} type="button">
          {dictionary.retry}
        </button>
      </div>
    );
  }
  return step === 'idle' ? <div aria-hidden className={styles.sentinel} ref={sentinel} /> : null;
}
