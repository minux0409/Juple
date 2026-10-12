'use client';

import { useEffect, useState } from 'react';
import type { AppDictionary } from '../../../../../../lib/appI18n';
import { isSessionLost } from '../../../../../../lib/authSession';
import { contentGateOf, isNotFound } from '../../../../../../lib/collectionDetails';
import { adderLabel, sharedItemPath, type SharedCollectionItem } from '../../../../../../lib/itemDetails';
import { unlockHeaders } from '../../../../../../lib/collectionUnlock';
import { collectionHref, displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, parseRouteId } from '../../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../../AppRoot';
import { Glyph } from '../../../../Glyph';
import { BackButton, LoadFailed, Notice } from '../../../../PageStates';
import { ItemDetailSkeleton } from '../../../../Skeletons';
import { linkTitleText } from '../../../../SavedLinkList';
import { ItemPhoto, OpenLinkButton, SourceRow } from '../../../../ItemParts';
import styles from '../../../../app.module.css';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'gated'; readonly gate: 'lock' | 'sharePassword' }
  | { readonly kind: 'loaded'; readonly item: SharedCollectionItem };

/**
 * Another member's link in a shared Collection - the mobile CollectionSharedItemScreen: only what the Collection shares (title, link,
 * automatic preview image, when it was added and who added it), read-only. Never that person's memo or photos. Reactions and
 * comments are not part of this Web round.
 */
export function SharedItemView({ collectionIdParam, itemIdParam }: { readonly collectionIdParam: string; readonly itemIdParam: string }) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const collectionId = parseRouteId(collectionIdParam);
  const itemId = parseRouteId(itemIdParam);
  const [state, setState] = useState<State>(collectionId === null || itemId === null ? { kind: 'notFound' } : { kind: 'loading' });
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
            onRetry={() => {
              setState({ kind: 'loading' });
              setReloadToken(token => token + 1);
            }}
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
          <OpenLinkButton dictionary={dictionary} url={item.url} />
        </div>
      </article>
    </section>
  );
}

function adderText(adder: NonNullable<ReturnType<typeof adderLabel>>, dictionary: AppDictionary): string {
  return adder.kind === 'me' ? dictionary.addedByMe : adder.kind === 'publicLink' ? dictionary.addedViaPublicLink : adder.name;
}
