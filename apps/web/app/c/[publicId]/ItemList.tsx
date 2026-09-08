'use client';

import { useState } from 'react';
import { getPublicCollectionItems, type PublicCollectionItem } from '../../../lib/publicApi';
import { ItemCard } from './ItemCard';

interface ItemListProps {
  readonly apiBaseUrl: string;
  readonly publicId: string;
  readonly initialItems: readonly PublicCollectionItem[];
  readonly initialNextCursor: string | null;
  readonly openLabel: string;
  readonly loadMoreLabel: string;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
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
}: ItemListProps) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const loadMore = async () => {
    if (isLoadingMore || !nextCursor) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await getPublicCollectionItems(apiBaseUrl, publicId, { cursor: nextCursor });
      // A null page here means the share was revoked between the initial load and this fetch -
      // treat it the same as "no more pages" rather than showing a broken state mid-scroll.
      setItems(previous => [...previous, ...(page?.items ?? [])]);
      setNextCursor(page?.nextCursor ?? null);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (items.length === 0) {
    return <p className="emptyState">{emptyLabel}</p>;
  }

  return (
    <>
      <ul className="itemList">
        {items.map((item, index) => (
          <ItemCard key={`${item.url}-${index}`} item={item} openLabel={openLabel} />
        ))}
      </ul>
      {nextCursor ? (
        <button
          className="loadMoreButton"
          disabled={isLoadingMore}
          onClick={loadMore}
          type="button"
        >
          {isLoadingMore ? loadingLabel : loadMoreLabel}
        </button>
      ) : null}
    </>
  );
}
