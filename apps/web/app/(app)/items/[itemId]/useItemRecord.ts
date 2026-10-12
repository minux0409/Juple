'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { contentGateOf, isNotFound } from '../../../../lib/collectionDetails';
import type { CollectionContentGate } from '../../../../lib/collectionGate';
import type { CollectionSummary } from '../../../../lib/collectionsView';
import { unlockHeadersFor } from '../../../../lib/collectionUnlock';
import {
  itemCollectionsPath,
  itemImagesReadPath,
  itemReadPath,
  type CollectionsPageOf,
  type ItemDetails,
  type ItemImage,
} from '../../../../lib/itemDetails';
import { holdItemOpenGrant, itemOpenGrantFor } from '../../../../lib/itemOpenGrant';
import { useSignedInApp } from '../../AppRoot';

export type ItemState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'notFound' }
  /** Opened from a locked card: the Collection's password stands before the link (nothing of it was sent). */
  | { readonly kind: 'gated'; readonly gate: CollectionContentGate }
  | { readonly kind: 'loaded'; readonly item: ItemDetails };
export type ListState<T> = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly items: readonly T[] };

/**
 * One of the person's own links as the details page and the editor read it (mobile ItemDetailsScreen load path): the link, its photo
 * list and every Collection it is in. `lockedBy` is the Collection that locks the link's Home / 보관함 card - the reads then go IN that
 * Collection with this opening's grant (never a context-free read of a gated link); without a usable grant the answer is `gated`
 * and `unlock` stores the grant a correct password returned and reads again.
 */
export function useItemRecord(itemId: number | null, lockedBy: number | null) {
  const { api, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<ItemState>(itemId === null ? { kind: 'notFound' } : { kind: 'loading' });
  const [images, setImages] = useState<ListState<ItemImage>>({ kind: 'loading' });
  const [collections, setCollections] = useState<ListState<CollectionSummary>>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [collectionsReloadToken, setCollectionsReloadToken] = useState(0);

  useEffect(() => {
    if (itemId === null) {
      return undefined;
    }
    let ignore = false;
    const headers = lockedBy === null ? undefined : unlockHeadersFor(itemOpenGrantFor(itemId, lockedBy));
    const lost = (error: unknown) => {
      if (isSessionLost(error)) {
        onSessionLost();
        return true;
      }
      return false;
    };
    api<ItemDetails>({ path: itemReadPath(itemId, lockedBy), headers }).then(
      item => {
        if (!ignore) {
          setState({ kind: 'loaded', item });
        }
      },
      error => {
        if (ignore || lost(error)) {
          return;
        }
        const gate = lockedBy === null ? null : contentGateOf(error);
        setState(gate ? { kind: 'gated', gate } : isNotFound(error) ? { kind: 'notFound' } : { kind: 'failed' });
      },
    );
    // The photo list only decides which own photo is the 대표 사진: without it the page still shows the cover / preview.
    api<{ readonly images: readonly ItemImage[] }>({ path: itemImagesReadPath(itemId, lockedBy), headers }).then(
      result => {
        if (!ignore) {
          setImages({ kind: 'loaded', items: result.images });
        }
      },
      error => {
        if (!ignore && !lost(error)) {
          setImages({ kind: 'failed' });
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, itemId, lockedBy, onSessionLost, reloadToken]);

  useEffect(() => {
    if (itemId === null) {
      return undefined;
    }
    let ignore = false;
    // Every Collection the link is in (no cap - all pages), mine and the shared ones.
    const loadAll = async () => {
      let all: readonly CollectionSummary[] = [];
      let cursor: string | null = null;
      do {
        const page: CollectionsPageOf = await api<CollectionsPageOf>({ path: itemCollectionsPath(itemId, cursor) });
        if (ignore) {
          return all;
        }
        all = [...all, ...page.items];
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    };
    loadAll().then(
      items => {
        if (!ignore) {
          setCollections({ kind: 'loaded', items });
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
        setCollections({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, itemId, onSessionLost, collectionsReloadToken]);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setImages({ kind: 'loading' });
    setReloadToken(token => token + 1);
  }, []);

  const reloadCollections = useCallback(() => {
    setCollections({ kind: 'loading' });
    setCollectionsReloadToken(token => token + 1);
  }, []);

  /** A correct password returned this grant: kept for this link's pages only, then the link is read again IN its Collection. */
  const unlock = useCallback(
    (grant: { readonly unlockToken: string; readonly expiresAtUtc: string }) => {
      if (itemId !== null && lockedBy !== null) {
        holdItemOpenGrant(itemId, lockedBy, grant);
      }
      reload();
    },
    [itemId, lockedBy, reload],
  );

  return { state, setState, images, setImages, collections, setCollections, reload, reloadCollections, unlock };
}
