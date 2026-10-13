'use client';

import { useEffect, useState } from 'react';
import type { AppDictionary } from '../../../../../../lib/appI18n';
import { isSessionLost } from '../../../../../../lib/authSession';
import { contentGateOf, isNotFound } from '../../../../../../lib/collectionDetails';
import { adderLabel, sharedItemPath, type SharedCollectionItem } from '../../../../../../lib/itemDetails';
import { unlockHeaders } from '../../../../../../lib/collectionUnlock';
import { displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, parseRouteId, siteIdOf, siteOf } from '../../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../../AppRoot';
import { Glyph } from '../../../../Glyph';
import { LoadFailed, Notice } from '../../../../PageStates';
import { linkTitleText } from '../../../../SavedLinkList';
import { SiteIcon } from '../../../../SiteIcon';
import { QuickThumb } from '../../../../items/[itemId]/ItemDetailContent';
import { ItemCollaboration } from '../../../../ItemCollaboration';
import styles from '../../../../app.module.css';

export type SharedItemState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'gated'; readonly gate: 'lock' | 'sharePassword' }
  | { readonly kind: 'loaded'; readonly item: SharedCollectionItem };

/**
 * Another member's link in a shared Collection, read IN that Collection (GET /api/v1/collections/{id}/items/{itemId} - the
 * Collection's own lock / share password first, with the visit's unlock grant): the one reading of both its standalone page and its
 * Quick Detail sheet.
 */
export function useSharedItem(collectionIdParam: string, itemIdParam: string) {
  const { api, onSessionLost } = useSignedInApp();
  const collectionId = parseRouteId(collectionIdParam);
  const itemId = parseRouteId(itemIdParam);
  const [state, setState] = useState<SharedItemState>(collectionId === null || itemId === null ? { kind: 'notFound' } : { kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (collectionId === null || itemId === null) {
      return undefined;
    }
    let ignore = false;
    api<SharedCollectionItem>({ path: sharedItemPath(collectionId, itemId), headers: unlockHeaders(collectionId) }).then(
      item => {
        if (!ignore) {
          setState({ kind: 'loaded', item });
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
        const gate = contentGateOf(error);
        setState(gate ? { kind: 'gated', gate } : isNotFound(error) ? { kind: 'notFound' } : { kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId, itemId, onSessionLost, reloadToken]);

  const reload = () => {
    setState({ kind: 'loading' });
    setReloadToken(token => token + 1);
  };
  return { collectionId, state, reload };
}

export function adderText(adder: NonNullable<ReturnType<typeof adderLabel>>, dictionary: AppDictionary): string {
  return adder.kind === 'me' ? dictionary.addedByMe : adder.kind === 'publicLink' ? dictionary.addedViaPublicLink : adder.name;
}

/**
 * Another member's link as Quick Detail content (the sheet over the Collection the person is in): the same look as their own link's
 * details - picture, name, site, the action column - but only what the Collection shares and read-only: 링크 열기 is its one action
 * (no 수정 / 삭제 - it is not theirs), then who added it and when, then the Collection's reactions and comments on it. Never that
 * person's memo or photos.
 */
export function SharedItemQuickContent({ collectionIdParam, itemIdParam }: { readonly collectionIdParam: string; readonly itemIdParam: string }) {
  const { dictionary, locale } = useSignedInApp();
  const { collectionId, state, reload } = useSharedItem(collectionIdParam, itemIdParam);

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
  if (state.kind === 'notFound') {
    return <Notice message={dictionary.sharedItemNotFound} />;
  }
  if (state.kind === 'gated') {
    return <Notice message={dictionary.collectionLockedWebMessage} title={state.gate === 'sharePassword' ? dictionary.collectionSharePasswordTitle : dictionary.collectionLockedTitle} />;
  }
  if (state.kind === 'failed') {
    return <LoadFailed dictionary={dictionary} message={dictionary.sharedItemLoadFailed} onRetry={reload} />;
  }

  const { item } = state;
  const title = displayTitleOf(item.title, item.url);
  const technical = title.kind === 'text' && title.technical;
  const siteId = siteIdOf(item.url);
  const site = siteOf(item.url) ?? item.url;
  const photoUrl = isSafeHttpUrl(item.previewImageUrl) ? item.previewImageUrl : null;
  const adder = adderLabel(item.addedBy);

  return (
    <article className={styles.quickContent} data-item-detail>
      <div className={styles.quickTop}>
        <QuickThumb dictionary={dictionary} photoUrl={photoUrl} siteId={siteId} />
        <div className={styles.quickHead}>
          <p className={styles.itemEyebrow}>{dictionary.sharedItemTitle}</p>
          <h2 className={styles.quickTitle} dir={technical ? 'ltr' : 'auto'}>
            {linkTitleText(title, dictionary)}
          </h2>
          <p className={styles.quickSite} dir="ltr">
            {siteId ? <SiteIcon siteId={siteId} size={16} /> : null}
            <span>{site}</span>
          </p>
        </div>
        {isSafeHttpUrl(item.url) ? (
          <div className={styles.quickActions}>
            <a aria-label={dictionary.openLink} className={styles.quickActionButton} href={item.url} rel="noopener noreferrer" target="_blank" title={dictionary.openLink}>
              <Glyph name="ExternalLink" size={20} />
            </a>
          </div>
        ) : null}
      </div>

      <dl className={styles.quickGroups}>
        {adder ? (
          <div className={styles.quickGroup}>
            <dt className={styles.quickLabel}>
              <Glyph name="People" size={16} />
              {dictionary.addedBy}
            </dt>
            <dd className={styles.quickValue} dir="auto">
              {adderText(adder, dictionary)}
            </dd>
          </div>
        ) : null}
        <div className={styles.quickGroup}>
          <dt className={styles.quickLabel}>
            <Glyph name="Clock" size={16} />
            {dictionary.savedAt}
          </dt>
          <dd className={styles.quickValue}>
            <time dateTime={item.addedAtUtc}>{formatLinkTimestamp(item.addedAtUtc, locale, true)}</time>
          </dd>
        </div>
      </dl>
      <p className={styles.readOnlyNote}>{dictionary.sharedItemReadOnly}</p>
      {/* Read-only means not theirs to edit or delete - any member may still react and comment (mobile CollectionSharedItemScreen). */}
      {collectionId !== null ? <ItemCollaboration always collectionId={collectionId} itemId={item.itemId} row={item} /> : null}
    </article>
  );
}
