'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AppDictionary } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { collectionTile, type CollectionSummary } from '../../../../lib/collectionsView';
import { unlockHeaders } from '../../../../lib/collectionUnlock';
import { representativePhotoUrl, type ItemImage } from '../../../../lib/itemDetails';
import { itemContextSearch, itemDeleteErrorMessage, itemEditHref, membershipErrorMessage } from '../../../../lib/itemEdit';
import { notifyItemsChanged } from '../../../../lib/itemChanges';
import { markEditOpenedFromDetails } from '../../../../lib/itemOverlay';
import { collectionHref, displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, parseRouteId, siteIdOf, siteOf } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { ItemCollaboration } from '../../ItemCollaboration';
import { ConfirmDialog } from '../../ConfirmDialog';
import { CollectionGlyph, Glyph } from '../../Glyph';
import { LinkImage } from '../../LinkImage';
import { LoadFailed, Notice } from '../../PageStates';
import { SiteIcon } from '../../SiteIcon';
import { linkTitleText } from '../../SavedLinkList';
import { GatedLink } from './GatedLink';
import { useItemRecord, type ListState } from './useItemRecord';
import styles from '../../app.module.css';

/**
 * A link's details - the ONE content of both the Quick Detail sheet (in-app click, over the current page) and the standalone
 * /items/{id} page (address bar, reload, external link): the same information in the same order, so they can never drift apart.
 *
 * The mobile Item Details: the 대표 사진 (only when there really is one), the name, the site and 링크 열기 (a new tab), the memo (only
 * when written), the Collections it is in (each opens its page) and when it was saved, with 수정 (the editor route) and 삭제.
 *
 *  - 삭제 moves the link to 삭제 이력 after a confirmation (DELETE /api/v1/items/{id}; recoverable there - the permanent endpoint is
 *    never used here). Opened from inside a Collection (`?collectionId=`) it is mobile's "컬렉션에서 삭제" instead: only that one
 *    membership goes, the link and its other Collections stay.
 *  - Opened from a locked Home / 보관함 card (`?lockedBy=`) the link is read IN that Collection; its password is asked right here.
 */
export function ItemDetailContent({
  itemIdParam,
  lockedBy,
  fromCollectionId,
  onLeave,
}: {
  readonly itemIdParam: string;
  readonly lockedBy: number | null;
  readonly fromCollectionId: number | null;
  /** After a successful 삭제 / 컬렉션에서 삭제: close the sheet, or leave the page. */
  readonly onLeave: () => void;
}) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const itemId = parseRouteId(itemIdParam);
  const { state, images, collections, reload, reloadCollections, unlock } = useItemRecord(itemId, lockedBy);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (state.kind === 'notFound') {
    return <Notice message={dictionary.itemLoadFailed} />;
  }
  if (state.kind === 'loading') {
    return (
      <div aria-busy aria-hidden className={styles.quickSkeleton}>
        <span className={`${styles.quickSkeletonThumb} ${styles.skeleton}`} />
        <span className={styles.quickSkeletonLines}>
          <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
          <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
        </span>
      </div>
    );
  }
  if (state.kind === 'failed') {
    return <LoadFailed dictionary={dictionary} message={dictionary.itemLoadFailed} onRetry={reload} />;
  }
  if (state.kind === 'gated' && lockedBy !== null && itemId !== null) {
    return <GatedLink collectionId={lockedBy} gate={state.gate} onGranted={unlock} onStateChanged={reload} />;
  }
  if (state.kind !== 'loaded' || itemId === null) {
    return null;
  }

  const { item } = state;
  // Until (or without) the photo list, the chosen cover stands in for the own photo.
  const coverAsImage: readonly ItemImage[] = item.coverImage?.readUrl ? [{ id: item.coverImage.id ?? 0, readUrl: item.coverImage.readUrl }] : [];
  const photoUrl = representativePhotoUrl(item.previewImageUrl, images.kind === 'loaded' ? images.items : coverAsImage, item.coverImage?.id);
  const title = displayTitleOf(item.title, item.url);
  const technical = title.kind === 'text' && title.technical;
  const siteId = siteIdOf(item.url);
  const site = siteOf(item.url) ?? item.url;
  // No picture: no empty media frame - a compact badge of the site heads the details instead.
  const hasImage = photoUrl !== null;
  const search = itemContextSearch({ lockedBy, fromCollectionId });
  const removeFromCollection = fromCollectionId !== null;

  const run = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const request = removeFromCollection
      ? api<void>({ method: 'DELETE', path: `/api/v1/collections/${fromCollectionId}/items/${itemId}`, headers: unlockHeaders(fromCollectionId) })
      : api<void>({ method: 'DELETE', path: `/api/v1/items/${itemId}` });
    request.then(
      () => {
        setConfirming(false);
        notifyItemsChanged();
        onLeave();
      },
      caught => {
        setBusy(false);
        setConfirming(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setActionError(removeFromCollection ? membershipErrorMessage(caught, dictionary) : itemDeleteErrorMessage(dictionary));
      },
    );
  };

  return (
    <article className={styles.quickContent} data-item-detail>
      <div className={styles.quickTop}>
        <QuickThumb dictionary={dictionary} photoUrl={hasImage ? photoUrl : null} siteId={siteId} />
        <div className={styles.quickHead}>
          <h2 className={styles.quickTitle} dir={technical ? 'ltr' : 'auto'}>
            {linkTitleText(title, dictionary)}
          </h2>
          <p className={styles.quickSite} dir="ltr">
            {siteId ? <SiteIcon siteId={siteId} size={16} /> : null}
            <span>{site}</span>
          </p>
        </div>
        {/* The link's actions, one icon-only column beside its name: 링크 열기, 수정, then 삭제 - or, opened from a Collection,
            컬렉션에서 제거 (only that membership; the link itself stays). The sheet's own 닫기 is in its bar, apart from these. */}
        <div className={styles.quickActions}>
          {isSafeHttpUrl(item.url) ? (
            <a aria-label={dictionary.openLink} className={styles.quickActionButton} href={item.url} rel="noopener noreferrer" target="_blank" title={dictionary.openLink}>
              <Glyph name="ExternalLink" size={20} />
            </a>
          ) : null}
          <Link
            aria-label={dictionary.edit}
            className={styles.quickActionButton}
            href={itemEditHref(itemId, search)}
            onClick={() => {
              // The editor comes back by going back to these details (their data is read again there).
              markEditOpenedFromDetails();
            }}
            title={dictionary.edit}
          >
            <Glyph name="Edit" size={20} />
          </Link>
          <button
            aria-label={removeFromCollection ? dictionary.removeFromCollectionAction : dictionary.delete}
            className={styles.quickActionDanger}
            disabled={busy}
            onClick={() => setConfirming(true)}
            title={removeFromCollection ? dictionary.removeFromCollectionAction : dictionary.delete}
            type="button"
          >
            <Glyph name="Trash" size={20} />
          </button>
        </div>
      </div>

      <dl className={styles.quickGroups}>
        {item.memo?.trim() ? (
          <div className={styles.quickGroup}>
            <dt className={styles.quickLabel}>
              <Glyph name="Edit" size={16} />
              {dictionary.memo}
            </dt>
            <dd className={styles.quickValue}>
              <p className={styles.quickMemo} dir="auto">
                {item.memo}
              </p>
            </dd>
          </div>
        ) : null}
        <div className={styles.quickGroup}>
          <dt className={styles.quickLabel}>
            <Glyph name="Folder" size={16} />
            {dictionary.collectionsLabel}
          </dt>
          <dd className={styles.quickValue}>
            <ItemCollections dictionary={dictionary} onRetry={reloadCollections} state={collections} />
          </dd>
        </div>
        <div className={styles.quickGroup}>
          <dt className={styles.quickLabel}>
            <Glyph name="Clock" size={16} />
            {dictionary.savedAt}
          </dt>
          <dd className={styles.quickValue}>
            <time dateTime={item.savedAtUtc}>{formatLinkTimestamp(item.savedAtUtc, locale, true)}</time>
          </dd>
        </div>
      </dl>

      {actionError ? (
        <p className={styles.fieldError} role="alert">
          {actionError}
        </p>
      ) : null}
      {/* Opened from a Collection that has other people in it: that Collection's reactions and comments on this link (mobile
          ItemDetails' collaboration hand-off). Never for a link opened from Home / 보관함 - it is not IN a Collection there. */}
      {fromCollectionId !== null ? <ItemCollaboration collectionId={fromCollectionId} itemId={itemId} /> : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={busy ? dictionary.deleting : removeFromCollection ? dictionary.removeFromCollection : dictionary.delete}
        destructive
        message={removeFromCollection ? dictionary.unlinkConfirmMessage : dictionary.itemDeleteConfirmMessage}
        onCancel={() => setConfirming(false)}
        onConfirm={run}
        open={confirming}
        title={removeFromCollection ? dictionary.unlinkConfirmTitle : dictionary.itemDeleteConfirmTitle}
      />
    </article>
  );
}

/** The head of a link's details: its picture, or - without one - a compact badge of its site instead of an empty media frame. */
export function QuickThumb({ photoUrl, siteId, dictionary }: { readonly photoUrl: string | null; readonly siteId: ReturnType<typeof siteIdOf>; readonly dictionary: AppDictionary }) {
  return photoUrl !== null ? (
    <div className={styles.quickThumb}>
      <LinkImage
        alt={dictionary.representativePhoto}
        fallback={
          <span aria-hidden className={styles.quickThumbFallback}>
            <SiteIcon siteId={siteId} size={40} />
          </span>
        }
        src={photoUrl}
      />
    </div>
  ) : (
    <span aria-hidden className={styles.quickSiteTile}>
      <SiteIcon siteId={siteId} size={32} />
    </span>
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
