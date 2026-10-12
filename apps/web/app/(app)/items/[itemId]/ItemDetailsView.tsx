'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AppDictionary } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { isNotFound } from '../../../../lib/collectionDetails';
import { collectionTile, type CollectionSummary } from '../../../../lib/collectionsView';
import { itemCollectionsPath, itemImagesPath, itemPath, representativePhotoUrl, type CollectionsPageOf, type ItemDetails, type ItemImage } from '../../../../lib/itemDetails';
import { collectionHref, displayTitleOf, formatLinkTimestamp, parseRouteId } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { CollectionGlyph, Glyph } from '../../Glyph';
import { BackButton, LoadFailed, Notice } from '../../PageStates';
import { ItemDetailSkeleton } from '../../Skeletons';
import { ItemPhoto, OpenLinkButton, SourceRow } from '../../ItemParts';
import { linkTitleText } from '../../SavedLinkList';
import styles from '../../app.module.css';

type ItemState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly item: ItemDetails };
type ListState<T> = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly items: readonly T[] };

/**
 * A link's page - the mobile Item Details read side: the 대표 사진, the name, the site and full link with 링크 열기 (a new tab), the
 * Collections it is in (each opens its page), when it was saved, and the memo. Editing the title / memo / photo, changing its
 * Collections and deleting it stay in the app for now.
 */
export function ItemDetailsView({ itemIdParam }: { readonly itemIdParam: string }) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const itemId = parseRouteId(itemIdParam);
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
    const lost = (error: unknown) => {
      if (isSessionLost(error)) {
        onSessionLost();
        return true;
      }
      return false;
    };
    api<ItemDetails>({ path: itemPath(itemId) }).then(
      item => {
        if (!ignore) {
          setState({ kind: 'loaded', item });
        }
      },
      error => {
        if (!ignore && !lost(error)) {
          setState(isNotFound(error) ? { kind: 'notFound' } : { kind: 'failed' });
        }
      },
    );
    // The photo list only decides which own photo is the 대표 사진: without it the page still shows the cover / preview.
    api<{ readonly images: readonly ItemImage[] }>({ path: itemImagesPath(itemId) }).then(
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
  }, [api, itemId, onSessionLost, reloadToken]);

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

  const back = <BackButton dictionary={dictionary} fallbackHref="/" />;

  if (state.kind === 'notFound') {
    return (
      <section className={styles.page}>
        {back}
        <Notice message={dictionary.itemLoadFailed} />
      </section>
    );
  }
  if (state.kind === 'loading') {
    return (
      <section aria-busy className={styles.page}>
        {back}
        <ItemDetailSkeleton />
      </section>
    );
  }
  if (state.kind === 'failed') {
    return (
      <section className={styles.page}>
        {back}
        <LoadFailed
          dictionary={dictionary}
          message={dictionary.itemLoadFailed}
          onRetry={() => {
            setState({ kind: 'loading' });
            setImages({ kind: 'loading' });
            setReloadToken(token => token + 1);
          }}
        />
      </section>
    );
  }

  const { item } = state;
  // Until (or without) the photo list, the chosen cover stands in for the own photo.
  const coverAsImage: readonly ItemImage[] = item.coverImage?.readUrl ? [{ id: item.coverImage.id ?? 0, readUrl: item.coverImage.readUrl }] : [];
  const photoUrl = representativePhotoUrl(item.previewImageUrl, images.kind === 'loaded' ? images.items : coverAsImage, item.coverImage?.id);
  const title = displayTitleOf(item.title, item.url);
  const technical = title.kind === 'text' && title.technical;

  return (
    <section className={styles.page}>
      {back}
      <article className={styles.itemDetail}>
        <ItemPhoto dictionary={dictionary} photoUrl={photoUrl} url={item.url} />
        <div className={styles.itemInfo}>
          <p className={styles.itemEyebrow}>{dictionary.itemDetailsTitle}</p>
          <h1 className={styles.itemTitle} dir={technical ? 'ltr' : 'auto'}>
            {linkTitleText(title, dictionary)}
          </h1>
          <SourceRow url={item.url} />
          <dl className={styles.infoRows}>
            <div className={styles.infoRow}>
              <dt className={styles.infoLabel}>
                <Glyph name="Clock" size={16} />
                {dictionary.savedAt}
              </dt>
              <dd className={styles.infoValue}>
                <time dateTime={item.savedAtUtc}>{formatLinkTimestamp(item.savedAtUtc, locale, true)}</time>
              </dd>
            </div>
            <div className={styles.infoRow}>
              <dt className={styles.infoLabel}>
                <Glyph name="Folder" size={16} />
                {dictionary.collectionsLabel}
              </dt>
              <dd className={styles.infoValue}>
                <ItemCollections
                  dictionary={dictionary}
                  onRetry={() => {
                    setCollections({ kind: 'loading' });
                    setCollectionsReloadToken(token => token + 1);
                  }}
                  state={collections}
                />
              </dd>
            </div>
          </dl>
          {item.memo?.trim() ? (
            <div className={styles.memoBlock}>
              <h2 className={styles.infoLabel}>
                <Glyph name="Edit" size={16} />
                {dictionary.memo}
              </h2>
              <p className={styles.memoText} dir="auto">
                {item.memo}
              </p>
            </div>
          ) : null}
          <OpenLinkButton dictionary={dictionary} url={item.url} />
        </div>
      </article>
    </section>
  );
}

function ItemCollections({ state, dictionary, onRetry }: { readonly state: ListState<CollectionSummary>; readonly dictionary: AppDictionary; readonly onRetry: () => void }) {
  if (state.kind === 'loading') {
    return <span className={styles.stateMessage}>…</span>;
  }
  if (state.kind === 'failed') {
    return (
      <span className={styles.inlineFailure}>
        {dictionary.loadFailedTitle}
        <button className={styles.linkButton} onClick={onRetry} type="button">
          {dictionary.retry}
        </button>
      </span>
    );
  }
  if (state.items.length === 0) {
    return <span className={styles.stateMessage}>{dictionary.noCollection}</span>;
  }
  return (
    <ul className={styles.collectionChips}>
      {state.items.map(collection => {
        const tile = collectionTile(collection.color, collection.id);
        return (
          <li key={collection.id}>
            <Link className={styles.collectionChip} href={collectionHref(collection.id)}>
              <span aria-hidden className={styles.collectionChipTile} style={{ background: tile.background, color: tile.icon }}>
                <CollectionGlyph icon={collection.icon} size={14} />
              </span>
              <span dir="auto">{collection.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
