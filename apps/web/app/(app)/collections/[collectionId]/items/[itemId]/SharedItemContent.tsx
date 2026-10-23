'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatMessage, type AppDictionary } from '../../../../../../lib/appI18n';
import { isSessionLost } from '../../../../../../lib/authSession';
import { collectionPath, contentGateOf, isNotFound } from '../../../../../../lib/collectionDetails';
import { isSharedWithMe } from '../../../../../../lib/collectionSharing';
import type { CollectionSummary } from '../../../../../../lib/collectionsView';
import { notifyItemsChanged } from '../../../../../../lib/itemChanges';
import { membershipErrorMessage } from '../../../../../../lib/itemEdit';
import { ConfirmDialog } from '../../../../ConfirmDialog';
import { useToast } from '../../../../Toaster';
import { adderLabel, sharedItemPath, type SharedCollectionItem } from '../../../../../../lib/itemDetails';
import { unlockHeaders, unlockTokenFor } from '../../../../../../lib/collectionUnlock';
import { addCopyResults, copyItemsPath, copyResultMessage, grantHeaders, NO_COPY, type CopyResult } from '../../../../../../lib/collectionOperations';
import { displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, parseRouteId, siteIdOf, siteOf } from '../../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../../AppRoot';
import { Glyph } from '../../../../Glyph';
import { CopyLinkButton } from '../../../../CopyLinkButton';
import { LoadFailed, Notice } from '../../../../PageStates';
import { linkTitleText } from '../../../../SavedLinkList';
import { SiteIcon } from '../../../../SiteIcon';
import { QuickThumb } from '../../../../items/[itemId]/ItemDetailContent';
import { ItemCollaboration } from '../../../../ItemCollaboration';
import { DestinationDialog, type PickedDestination } from '../../../../DestinationDialog';
import { ActionMenu, type MenuAction } from '../../../../Popover';
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

/**
 * 내 컬렉션으로 복사 of another member's link (mobile openSingleCopyPicker): into any of MY Collections, one request per destination,
 * one after the other. The server makes my own new Item of the URL, title and automatic preview only - never their memo, photos, who
 * added it, comments or reactions - and skips a URL the destination already has. Nothing copied anywhere rejects (the dialog stays,
 * with the reason); a partial result says what was and was not copied.
 */
export function useCopyToMine(collectionId: number | null, itemId: number | null) {
  const { api, dictionary } = useSignedInApp();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const copyTo = async (picked: readonly PickedDestination[]) => {
    if (collectionId === null || itemId === null) {
      return;
    }
    let total = NO_COPY;
    let failed = 0;
    let firstFailure: unknown = null;
    for (const destination of picked) {
      try {
        const result = await api<CopyResult>({
          method: 'POST',
          path: copyItemsPath(collectionId),
          body: { destinationCollectionId: destination.collection.id, itemIds: [itemId] },
          headers: grantHeaders(unlockTokenFor(collectionId), destination.unlockToken),
        });
        total = addCopyResults(total, result);
      } catch (caught) {
        firstFailure ??= caught;
        failed += 1;
      }
    }
    if (failed === picked.length) {
      throw firstFailure;
    }
    setNotice(failed > 0 ? `${copyResultMessage(total, dictionary)} ${formatMessage(dictionary.copyDestinationsFailed, { count: failed })}` : copyResultMessage(total, dictionary));
  };

  const actions: readonly MenuAction[] = collectionId === null || itemId === null ? [] : [{ key: 'copyToMine', label: dictionary.copyToMine, icon: 'Copy', onSelect: () => setOpen(true) }];
  const dialog =
    open && collectionId !== null ? (
      <DestinationDialog
        confirmLabel={dictionary.confirmCopy}
        errorMessage={() => dictionary.copyError}
        excluded={[collectionId]}
        onClose={() => setOpen(false)}
        onSubmit={copyTo}
        selection="multiple"
        title={dictionary.copyToMine}
      />
    ) : null;
  const noticeLine = notice ? (
    <p className={styles.formNotice} role="status">
      {notice}
    </p>
  ) : null;
  return { actions, dialog, notice: noticeLine } as const;
}

/**
 * 컬렉션에서 제거 for the Collection's OWNER on another member's link (mobile: the sheet's one action there). It removes only this link's
 * membership in this Collection - DELETE /collections/{id}/items/{itemId}, never the Item: the link stays in its adder's library and in
 * their other Collections. Only the Owner is offered it (the role is read from the Collection once; a plain member sees nothing), and the
 * server decides again - a refusal removes nothing from the screen. It asks first; on success the Collection's list and count follow
 * through the same signal every removal uses.
 */
export function useRemoveFromCollection(collectionId: number | null, itemId: number | null, onLeave: () => void) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [isOwner, setIsOwner] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (collectionId === null) {
      return undefined;
    }
    let ignore = false;
    api<CollectionSummary>({ path: collectionPath(collectionId), headers: unlockHeaders(collectionId) }).then(
      collection => {
        if (!ignore) setIsOwner(!isSharedWithMe(collection));
      },
      () => {
        if (!ignore) setIsOwner(false);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId]);

  const remove = async () => {
    if (collectionId === null || itemId === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await api<void>({ method: 'DELETE', path: sharedItemPath(collectionId, itemId), headers: unlockHeaders(collectionId) });
      setConfirming(false);
      notifyItemsChanged({ kind: 'removedFromCollection', itemId, collectionId });
      toast.showNotice(dictionary.unlinkSuccess);
      onLeave();
    } catch (caught) {
      setConfirming(false);
      if (isSessionLost(caught)) {
        onSessionLost();
      } else {
        toast.showNotice(membershipErrorMessage(caught, dictionary), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const actions: readonly MenuAction[] = isOwner && collectionId !== null && itemId !== null
    ? [{ key: 'removeFromCollection', label: dictionary.removeFromCollection, icon: 'Trash', destructive: true, onSelect: () => setConfirming(true) }]
    : [];
  const dialog = (
    <ConfirmDialog
      busy={busy}
      cancelLabel={dictionary.cancel}
      confirmLabel={dictionary.removeFromCollection}
      destructive
      message={dictionary.unlinkConfirmMessage}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void remove()}
      open={confirming}
      title={dictionary.unlinkConfirmTitle}
    />
  );
  return { actions, dialog, isOwner } as const;
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
  const copy = useCopyToMine(collectionId, parseRouteId(itemIdParam));
  const router = useRouter();
  // Removed from the Collection: the sheet closes (back to the Collection, which already lost the link and one from its count).
  const removal = useRemoveFromCollection(collectionId, parseRouteId(itemIdParam), () => router.back());

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
        <div className={styles.quickActions}>
          {isSafeHttpUrl(item.url) ? (
            <a aria-label={dictionary.openLink} className={styles.quickActionButton} href={item.url} rel="noopener noreferrer" target="_blank" title={dictionary.openLink}>
              <Glyph name="ExternalLink" size={20} />
            </a>
          ) : null}
          {isSafeHttpUrl(item.url) ? <CopyLinkButton url={item.url} /> : null}
          {/* Not mine: never moved or edited here - only 내 컬렉션으로 복사 (a new link of my own). */}
          <ActionMenu actions={[...copy.actions, ...removal.actions]} className={styles.quickActionButton} label={dictionary.linkActionsLabel} />
        </div>
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
      {copy.notice}
      {copy.dialog}
      {removal.dialog}
      {/* Read-only means not theirs to edit or delete - any member may still react and comment (mobile CollectionSharedItemScreen). */}
      {collectionId !== null ? <ItemCollaboration always collectionId={collectionId} itemId={item.itemId} row={item} /> : null}
    </article>
  );
}
