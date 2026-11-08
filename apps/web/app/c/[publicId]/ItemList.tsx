'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getPublicCollectionItems,
  LOCKED,
  PublicRateLimitError,
  type PublicCollectionItem,
  type PublicCollectionItemsPage,
} from '../../../lib/publicApi';
import { ItemCard } from './ItemCard';
import { ViewToggle, type ViewMode } from './ViewToggle';

interface ItemListProps {
  readonly apiBaseUrl: string;
  readonly publicId: string;
  readonly initialItems: readonly PublicCollectionItem[];
  readonly initialNextCursor: string | null;
  readonly openLabel: string;
  readonly loadMoreLabel: string;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  /** '{count}' is replaced by the exact number of links, shown only when no further page remains. */
  readonly countLabel: string;
  /**
   * A locked share's grant is an HttpOnly cookie this component cannot (and must not) read, so its
   * further pages come through this app's own same-origin route handler, which attaches the grant
   * server-side. An unlocked share keeps calling the Public API directly.
   */
  readonly isLocked: boolean;
  readonly viewLabels: { readonly group: string; readonly list: string; readonly grid: string; readonly image: string };
}

async function fetchNextPage(
  apiBaseUrl: string,
  publicId: string,
  cursor: string,
  isLocked: boolean,
): Promise<PublicCollectionItemsPage | null> {
  if (!isLocked) {
    const page = await getPublicCollectionItems(apiBaseUrl, publicId, { cursor });
    return page === LOCKED ? null : page;
  }

  const response = await fetch(`/c/${encodeURIComponent(publicId)}/items?cursor=${encodeURIComponent(cursor)}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (response.status === 403) {
    // The grant expired or the password changed - reload into the password form.
    window.location.reload();
    return null;
  }
  if (response.status === 429) throw new PublicRateLimitError(response);
  return response.ok ? ((await response.json()) as PublicCollectionItemsPage) : null;
}

/**
 * A Client Component only for the "load more" step - the first page renders straight from the
 * Server Component parent (page.tsx) with no client-side fetch/loading flash. Further pages are
 * fetched directly from the browser against the Public API (see lib/publicApi.ts) - that's exactly
 * what the "PublicWeb" CORS policy on the Backend exists for (GET-only, this origin only).
 *
 * apiBaseUrl is a prop from page.tsx (which reads the runtime JUPLE_API_BASE_URL env var), never a
 * NEXT_PUBLIC_* env var read here - it arrives as a plain string in this request's own RSC/HTML
 * payload, not a value frozen into the client JS bundle at `next build` time. This is what keeps
 * one Docker image usable across Dev/Staging/Prod with no rebuild (see lib/publicApi.ts).
 */
export function ItemList({
  apiBaseUrl,
  publicId,
  initialItems,
  initialNextCursor,
  openLabel,
  loadMoreLabel,
  loadingLabel,
  emptyLabel,
  countLabel,
  isLocked,
  viewLabels,
}: ItemListProps) {
  const [mode, setMode] = useState<ViewMode>('list');
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const busy = useRef(false);
  const retryAt = useRef(0);
  const [waiting, setWaiting] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const loadMore = async () => {
    if (busy.current || Date.now() < retryAt.current || !nextCursor) {
      return;
    }

    busy.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchNextPage(apiBaseUrl, publicId, nextCursor, isLocked);
      // A null page here means the share was revoked between the initial load and this fetch -
      // treat it the same as "no more pages" rather than showing a broken state mid-scroll.
      setItems(previous => [...previous, ...(page?.items ?? [])]);
      setNextCursor(page?.nextCursor ?? null);
    } catch (error) {
      // Keep the cursor and already loaded items; no automatic retry and no false end-of-list.
      if (error instanceof PublicRateLimitError) {
        retryAt.current = Date.now() + error.retryAfterSeconds * 1000;
        setWaiting(true);
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => setWaiting(false), error.retryAfterSeconds * 1000);
      }
    } finally {
      busy.current = false;
      setIsLoadingMore(false);
    }
  };

  if (items.length === 0) {
    return <p className="emptyState">{emptyLabel}</p>;
  }

  return (
    <>
      {/* Mobile content row: the link count (chain icon + text) at the start, List / Grid / Image at the end edge. The public API has no
          total, so the number is shown only once every page is loaded (then it is exact) - never an "8+" estimate. */}
      <div className="shareControls">
        {nextCursor ? null : (
          <p className="linkCount">
            <svg aria-hidden className="linkCountIcon" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
            </svg>
            <span>{countLabel.replace('{count}', String(items.length))}</span>
          </p>
        )}
        <ViewToggle labels={viewLabels} onChange={setMode} value={mode} />
      </div>
      <ul className={`itemList itemList-${mode}`}>
        {items.map((item, index) => (
          <ItemCard key={`${item.url}-${index}`} item={item} openLabel={openLabel} />
        ))}
      </ul>
      {nextCursor ? (
        <button
          className="loadMoreButton"
          disabled={isLoadingMore || waiting}
          onClick={loadMore}
          type="button"
        >
          {isLoadingMore ? loadingLabel : loadMoreLabel}
        </button>
      ) : null}
    </>
  );
}
