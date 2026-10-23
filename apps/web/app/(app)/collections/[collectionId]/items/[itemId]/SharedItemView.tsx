'use client';

import { adderLabel } from '../../../../../../lib/itemDetails';
import { collectionHref, displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, parseRouteId } from '../../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../../AppRoot';
import { Glyph } from '../../../../Glyph';
import { BackButton, LoadFailed, Notice } from '../../../../PageStates';
import { ItemDetailSkeleton } from '../../../../Skeletons';
import { linkTitleText } from '../../../../SavedLinkList';
import { ItemPhoto, OpenLinkButton, SourceRow } from '../../../../ItemParts';
import { ItemCollaboration } from '../../../../ItemCollaboration';
import { useRouter } from 'next/navigation';
import { adderText, useCopyToMine, useRemoveFromCollection, useSharedItem } from './SharedItemContent';
import { ActionMenu } from '../../../../Popover';
import styles from '../../../../app.module.css';

/**
 * Another member's link in a shared Collection - the mobile CollectionSharedItemScreen: only what the Collection shares (title, link,
 * automatic preview image, when it was added and who added it), read-only - then, as on mobile, the Collection's reactions and
 * comments on it (read-only means not theirs to edit or delete; any member may react and comment). Never that person's memo or photos.
 */
export function SharedItemView({ collectionIdParam, itemIdParam }: { readonly collectionIdParam: string; readonly itemIdParam: string }) {
  const { dictionary, locale } = useSignedInApp();
  const { collectionId, state, reload } = useSharedItem(collectionIdParam, itemIdParam);
  const copy = useCopyToMine(collectionId, parseRouteId(itemIdParam));
  const router = useRouter();
  // The Owner's 컬렉션에서 제거: only the link's membership here; afterwards back to the Collection.
  const removal = useRemoveFromCollection(collectionId, parseRouteId(itemIdParam), () => router.push(collectionId === null ? '/collections' : collectionHref(collectionId)));

  const back = <BackButton dictionary={dictionary} fallbackHref={collectionId === null ? '/collections' : collectionHref(collectionId)} />;

  if (state.kind !== 'loaded') {
    return (
      <section aria-busy={state.kind === 'loading'} className={styles.page}>
        {back}
        {state.kind === 'loading' ? <ItemDetailSkeleton /> : null}
        {state.kind === 'notFound' ? <Notice message={dictionary.sharedItemNotFound} /> : null}
        {state.kind === 'gated' ? (
          <Notice message={dictionary.collectionLockedWebMessage} title={state.gate === 'sharePassword' ? dictionary.collectionSharePasswordTitle : dictionary.collectionLockedTitle} />
        ) : null}
        {state.kind === 'failed' ? (
          <LoadFailed
            dictionary={dictionary}
            message={dictionary.sharedItemLoadFailed}
            onRetry={reload}
          />
        ) : null}
      </section>
    );
  }

  const { item } = state;
  const title = displayTitleOf(item.title, item.url);
  const technical = title.kind === 'text' && title.technical;
  const adder = adderLabel(item.addedBy);
  const photoUrl = isSafeHttpUrl(item.previewImageUrl) ? item.previewImageUrl : null;

  return (
    <section className={styles.page}>
      {back}
      <article className={styles.itemDetail}>
        <ItemPhoto dictionary={dictionary} photoUrl={photoUrl} url={item.url} />
        <div className={styles.itemInfo}>
          <p className={styles.itemEyebrow}>{dictionary.sharedItemTitle}</p>
          <h1 className={styles.itemTitle} dir={technical ? 'ltr' : 'auto'}>
            {linkTitleText(title, dictionary)}
          </h1>
          <SourceRow url={item.url} />
          <dl className={styles.infoRows}>
            {adder ? (
              <div className={styles.infoRow}>
                <dt className={styles.infoLabel}>
                  <Glyph name="People" size={16} />
                  {dictionary.addedBy}
                </dt>
                <dd className={styles.infoValue} dir="auto">
                  {adderText(adder, dictionary)}
                </dd>
              </div>
            ) : null}
            <div className={styles.infoRow}>
              <dt className={styles.infoLabel}>
                <Glyph name="Clock" size={16} />
                {dictionary.savedAt}
              </dt>
              <dd className={styles.infoValue}>
                <time dateTime={item.addedAtUtc}>{formatLinkTimestamp(item.addedAtUtc, locale, true)}</time>
              </dd>
            </div>
          </dl>
          <p className={styles.readOnlyNote}>{dictionary.sharedItemReadOnly}</p>
          <div className={styles.formActions}>
            <OpenLinkButton dictionary={dictionary} url={item.url} />
            <ActionMenu actions={[...copy.actions, ...removal.actions]} label={dictionary.linkActionsLabel} />
          </div>
          {copy.notice}
          {copy.dialog}
          {removal.dialog}
        </div>
      </article>
      {collectionId !== null ? <ItemCollaboration always collectionId={collectionId} itemId={item.itemId} row={item} /> : null}
    </section>
  );
}
