'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { AppDictionary } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { collectionTile, type CollectionSummary } from '../../../../lib/collectionsView';
import { unlockHeaders, unlockTokenFor } from '../../../../lib/collectionUnlock';
import { grantHeaders, isCollaborationActive, itemRestorePath, membershipPath, moveStrategy, moveUndoPath, replicatePath, replicateResultMessage, transferPath, type ReplicateResult } from '../../../../lib/collectionOperations';
import { recordLinkOpened } from '../../../../lib/recentLinks';
import { isRemovalOwnerOnly, ITEM_IMAGE_ACCEPT, itemDeleteErrorMessage, membershipErrorMessage } from '../../../../lib/itemEdit';
import { notifyItemsChanged } from '../../../../lib/itemChanges';
import { collectionHref, displayTitleOf, isSafeHttpUrl, parseRouteId, siteIdOf, siteOf } from '../../../../lib/savedLinks';
import { SavedAtValue } from '../../SavedAtValue';
import { useSignedInApp } from '../../AppRoot';
import { useToast } from '../../Toaster';
import { ItemCollaboration } from '../../ItemCollaboration';
import { ConfirmDialog } from '../../ConfirmDialog';
import { DestinationDialog, type PickedDestination } from '../../DestinationDialog';
import { ActionMenu } from '../../Popover';
import { CollectionGlyph, Glyph } from '../../Glyph';
import { CopyLinkButton } from '../../CopyLinkButton';
import { LoadFailed, Notice } from '../../PageStates';
import { LinkImage } from '../../LinkImage';
import { SiteIcon } from '../../SiteIcon';
import { CollectionPicker } from '../../CollectionPicker';
import { ItemPhoto } from '../../ItemParts';
import { Modal } from '../../Modal';
import { PhotoEditor } from '../../PhotoEditor';
import { SaveOutcomeDialog } from '../../SaveOutcomeDialog';
import { linkTitleText } from '../../SavedLinkList';
import { GatedLink } from './GatedLink';
import { useLeaveGuard } from './LeaveGuard';
import { useItemEditor } from './useItemEditor';
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
  onGone,
}: {
  readonly itemIdParam: string;
  readonly lockedBy: number | null;
  readonly fromCollectionId: number | null;
  /** After a successful 삭제 / 컬렉션에서 삭제: close the sheet, or leave the page. */
  readonly onLeave: () => void;
  /** The sheet only: the link turned out to be gone (404) - close instead of leaving an empty sheet. The standalone page keeps its message. */
  readonly onGone?: () => void;
}) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const itemId = parseRouteId(itemIdParam);
  const record = useItemRecord(itemId, lockedBy);
  const { state, collections, reload, reloadCollections, unlock } = record;
  // Saving ends the visit like deleting does: the lists under the sheet read the link again, then the sheet closes.
  const editor = useItemEditor({
    itemId,
    record,
    onSaved: () => {
      if (itemId !== null) {
        notifyItemsChanged({ kind: 'updated', itemId });
      }
      toast.showNotice(dictionary.itemSaved);
      onLeave();
    },
  });
  useLeaveGuard(editor.isDirty);
  const [editingCollections, setEditingCollections] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [destination, setDestination] = useState<'replicate' | 'move' | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);

  // A confirmed 404 (deleted elsewhere / in another tab): the card that opened this is stale. The lists read themselves again (the
  // server decides what is really gone) and the sheet closes. Only a real 404 gets here - 401 / 403 / network are `failed`.
  const gone = state.kind === 'notFound' && itemId !== null;
  useEffect(() => {
    if (gone && itemId !== null) {
      notifyItemsChanged({ kind: 'updated', itemId });
      onGone?.();
    }
    // `onGone` is a fresh closure per render; the transition into notFound is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone, itemId]);

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
  const title = displayTitleOf(item.title, item.url);
  const technical = title.kind === 'text' && title.technical;
  const siteId = siteIdOf(item.url);
  const site = siteOf(item.url) ?? item.url;
  const removeFromCollection = fromCollectionId !== null;

  /** 다른 컬렉션에 복제: more memberships of this one Item in one request (never a copy of it); what was already there is skipped. */
  const replicateTo = async (picked: readonly PickedDestination[]) => {
    const unlockTokens: Record<number, string> = {};
    for (const entry of picked) {
      if (entry.unlockToken) {
        unlockTokens[entry.collection.id] = entry.unlockToken;
      }
    }
    const result = await api<ReplicateResult>({ method: 'POST', path: replicatePath(itemId), body: { collectionIds: picked.map(entry => entry.collection.id), unlockTokens } });
    setLinkNotice(replicateResultMessage(result, dictionary));
    reloadCollections();
    notifyItemsChanged({ kind: 'updated', itemId });
  };

  /**
   * 다른 컬렉션으로 이동 (mobile moveItemTo): the server's one atomic move between two Collections nobody else is in; otherwise - or when
   * the server still sees collaboration (a pending invitation) - add to the destination FIRST, then take it out of here, so a failure in
   * between leaves the link in both, never in neither. The link is no longer in this Collection afterwards: its details close.
   */
  const moveTo = async (target: PickedDestination) => {
    const source = collections.kind === 'loaded' ? collections.items.find(entry => entry.id === fromCollectionId) : undefined;
    let moved = false;
    // The atomic move has a server-side reverse (mobile's undoTransferCollectionItem); the add-then-remove way has none, so it offers none.
    let undoMove: (() => Promise<void>) | null = null;
    if (source && moveStrategy(source, target.collection) === 'atomic') {
      try {
        const sourceId = fromCollectionId as number;
        const headers = grantHeaders(unlockTokenFor(sourceId), target.unlockToken);
        const result = await api<{ readonly targetMembershipCreated?: boolean } | undefined>({ method: 'POST', path: transferPath(sourceId, itemId), body: { targetCollectionId: target.collection.id }, headers });
        moved = true;
        const targetMembershipCreated = result?.targetMembershipCreated === true;
        undoMove = async () => {
          await api<void>({ method: 'POST', path: moveUndoPath(sourceId, itemId), body: { targetCollectionId: target.collection.id, targetMembershipCreated }, headers });
          notifyItemsChanged({ kind: 'refresh' });
        };
      } catch (caught) {
        if (!isCollaborationActive(caught)) {
          throw caught;
        }
      }
    }
    if (!moved) {
      await api<unknown>({ method: 'PUT', path: membershipPath(target.collection.id, itemId), headers: grantHeaders(target.unlockToken) });
      await api<void>({ method: 'DELETE', path: membershipPath(fromCollectionId as number, itemId), headers: unlockHeaders(fromCollectionId as number) });
    }
    // Only this Collection's membership went (the atomic transfer or the add + remove): the link stays in 보관함 / Home.
    if (undoMove) {
      toast.showUndo({ message: dictionary.toastMoved, errorMessage: dictionary.toastUndoMoveError, undo: undoMove });
    }
    notifyItemsChanged({ kind: 'removedFromCollection', itemId, collectionId: fromCollectionId as number });
    onLeave();
  };

  const run = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError(null);
    // The grant of this visit is taken now as well: the sheet closes and the Collection's page may forget it before 되돌리기 is pressed.
    const undoHeaders = fromCollectionId !== null ? unlockHeaders(fromCollectionId) : undefined;
    const request = removeFromCollection
      ? api<void>({ method: 'DELETE', path: `/api/v1/collections/${fromCollectionId}/items/${itemId}`, headers: unlockHeaders(fromCollectionId) })
      : api<void>({ method: 'DELETE', path: `/api/v1/items/${itemId}` });
    request.then(
      () => {
        setConfirming(false);
        // Two different facts: the link is gone everywhere, or only this Collection's membership went.
        notifyItemsChanged(
          fromCollectionId !== null ? { kind: 'removedFromCollection', itemId, collectionId: fromCollectionId } : { kind: 'deleted', itemId },
        );
        // Mobile's snackbar: the result is already on screen; 되돌리기 uses the server's own reverse of exactly this action.
        toast.showUndo(
          fromCollectionId !== null
            ? {
                message: dictionary.toastRemovedFromCollection,
                errorMessage: dictionary.toastUndoRemoveError,
                undo: async () => {
                  await api<unknown>({ method: 'PUT', path: membershipPath(fromCollectionId, itemId), headers: undoHeaders });
                  notifyItemsChanged({ kind: 'refresh' });
                },
              }
            : {
                message: dictionary.toastDeleted,
                errorMessage: dictionary.toastUndoDeleteError,
                undo: async () => {
                  await api<void>({ method: 'POST', path: itemRestorePath(itemId) });
                  notifyItemsChanged({ kind: 'refresh' });
                },
              },
        );
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

  // Opening the original page is noted for 최근 조회한 링크 (best effort, silent).
  const noteOpened = () => void recordLinkOpened(api, itemId);

  return (
    <article className={styles.quickContent} data-item-detail>
      <div className={styles.detailLayout}>
        {/* The picture: hover (or focus, or touch) shows 사진 변경 over it - the link's photo is changed right here, never on another screen. */}
        <div className={styles.itemEdMedia}>
          <PhotoEditor
            placeholderGlyph
            busy={editor.photoBusy}
            changeLabel={editor.photoBusy ? dictionary.uploading : editor.photoUrl ? dictionary.changePhoto : dictionary.addPhoto}
            hasPhoto={editor.photoUrl !== null}
            onChange={() => fileInput.current?.click()}
            onRemove={editor.ownPhoto ? () => editor.setConfirmingPhotoDelete(true) : undefined}
            removeLabel={dictionary.removePhoto}
          >
            <ItemPhoto cacheKey={editor.photoKey} dictionary={dictionary} photoUrl={editor.photoUrl} url={item.url} />
          </PhotoEditor>
          <input accept={ITEM_IMAGE_ACCEPT} aria-label={dictionary.addPhoto} hidden onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              editor.pickPhoto(file);
            }} ref={fileInput} type="file" />
          {editor.photoError ? (
            <p className={styles.fieldError} role="alert">
              {editor.photoError}
            </p>
          ) : null}
        </div>

        <div className={styles.detailMain}>
          <input
            aria-label={dictionary.titleLabel}
            className={styles.detailTitleInput}
            dir={technical ? 'ltr' : 'auto'}
            onChange={event => editor.setTitle(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void editor.save();
              }
            }}
            placeholder={linkTitleText(title, dictionary)}
            value={editor.title}
          />
          {/* Where it is from, with 바로가기 and 복사 right beside it (no separate action row). */}
          <div className={styles.detailSource}>
            <p className={styles.itemEdSite} dir="ltr">
              {siteId ? <SiteIcon siteId={siteId} size={18} /> : null}
              <span>{site}</span>
            </p>
            <div className={styles.detailSourceActions}>
              {isSafeHttpUrl(item.url) ? (
                <a aria-label={dictionary.openLink} className={styles.quickActionButton} href={item.url} onAuxClick={noteOpened} onClick={noteOpened} rel="noopener noreferrer" target="_blank" title={dictionary.openLink}>
                  <Glyph name="ExternalLink" size={18} />
                </a>
              ) : null}
              {isSafeHttpUrl(item.url) ? <CopyLinkButton url={item.url} /> : null}
              {/* Opened IN a Collection: 다른 컬렉션에 복제 / 이동 behind one ⋯ (the row never grows a button per action). */}
              {removeFromCollection ? (
                <ActionMenu
                  actions={[
                    { key: 'replicate', label: dictionary.addToOther, icon: 'Copy', onSelect: () => setDestination('replicate') },
                    { key: 'move', label: dictionary.moveToOther, icon: 'Move', onSelect: () => setDestination('move') },
                  ]}
                  className={styles.quickActionButton}
                  label={dictionary.linkActionsLabel}
                />
              ) : null}
            </div>
          </div>

          <label className={styles.detailField}>
            <span className={styles.detailLabel}>
              <Glyph name="Edit" size={16} />
              {dictionary.memo}
            </span>
            <textarea className={styles.itemEdMemo} dir="auto" onChange={event => editor.setMemo(event.target.value)} placeholder={dictionary.memoPlaceholder} rows={3} value={editor.memo} />
          </label>

          <div className={styles.detailField}>
            <span className={styles.detailLabel}>
              <Glyph name="Folder" size={16} />
              {dictionary.collectionsLabel}
            </span>
            <div className={styles.detailCollections}>
              <div className={styles.detailCollectionsList}>
                <ItemCollections dictionary={dictionary} onRetry={reloadCollections} selected={editor.selected} state={collections} />
              </div>
              <button
                aria-label={dictionary.edit}
                className={styles.detailPencil}
                data-edit-collections
                disabled={collections.kind !== 'loaded'}
                onClick={() => {
                  editor.loadDestinationsNow();
                  setEditingCollections(true);
                }}
                title={dictionary.edit}
                type="button"
              >
                <Glyph name="Edit" size={18} />
              </button>
            </div>
          </div>

          <p className={styles.detailSaved}>
            <Glyph name="Clock" size={14} />
            <span>{dictionary.savedAt}</span>
            <SavedAtValue locale={locale} utc={item.savedAtUtc} />
          </p>
        </div>
      </div>

      {actionError ? (
        <p className={styles.fieldError} role="alert">
          {actionError}
        </p>
      ) : null}
      {editor.saveError ? (
        <div className={styles.fieldError} role="alert">
          {editor.saveError.split('\n').map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {linkNotice ? (
        <p className={styles.formNotice} role="status">
          {linkNotice}
        </p>
      ) : null}
      {destination !== null && fromCollectionId !== null ? (
        <DestinationDialog
          confirmLabel={destination === 'move' ? dictionary.confirmMove : dictionary.cloneSubmit}
          contained={destination === 'replicate' && collections.kind === 'loaded' ? collections.items.map(entry => entry.id) : []}
          errorMessage={() => (destination === 'move' ? dictionary.moveError : dictionary.replicateError)}
          excluded={destination === 'move' ? [fromCollectionId] : []}
          onClose={() => setDestination(null)}
          onSubmit={picked => (destination === 'move' ? moveTo(picked[0]) : replicateTo(picked))}
          selection={destination === 'move' ? 'single' : 'multiple'}
          title={destination === 'move' ? dictionary.moveToOther : dictionary.addToOther}
        />
      ) : null}
      {/* Opened from a Collection that has other people in it: that Collection's reactions and comments on this link (mobile
          ItemDetails' collaboration hand-off). Never for a link opened from Home / 보관함 - it is not IN a Collection there. */}
      {fromCollectionId !== null ? <ItemCollaboration collectionId={fromCollectionId} itemId={itemId} /> : null}

      {/* The two main actions, always in reach at the foot of the sheet (mobile): 삭제 (or 컬렉션에서 제거) and 저장 - which only wakes up
          once something changed. */}
      <footer className={styles.detailFooter}>
        <button
          className={styles.detailDelete}
          disabled={busy || editor.saving}
          onClick={() => setConfirming(true)}
          type="button"
        >
          <Glyph name="Trash" size={18} />
          {removeFromCollection ? dictionary.removeFromCollectionAction : dictionary.delete}
        </button>
        <button className={styles.detailSave} data-detail-save disabled={editor.saving || !editor.isDirty} onClick={() => void editor.save()} type="button">
          {editor.saving ? dictionary.saving : dictionary.save}
        </button>
      </footer>

      <Modal closeLabel={dictionary.close} onClose={() => setEditingCollections(false)} open={editingCollections} title={dictionary.collectionsLabel}>
        <div className={styles.detailCollectionsDialog}>
          <CollectionPicker
            clearable
            destinations={editor.membershipsReady ? editor.options : null}
            failed={editor.destinationsFailed || collections.kind === 'failed'}
            isDeselectBlocked={collection => editor.original.has(collection.id) && isRemovalOwnerOnly(collection)}
            noneSelected={editor.selected.length === 0}
            onCreated={editor.onCreated}
            onRefreshed={editor.onRefreshed}
            onToggle={editor.toggleCollection}
            onUnavailable={editor.onUnavailable}
            selectedIds={editor.selectedIds}
            session={editor.pickerSession}
          />
          <div className={styles.detailDialogFoot}>
            <button className={styles.primaryAction} onClick={() => setEditingCollections(false)} type="button">
              {dictionary.confirm}
            </button>
          </div>
        </div>
      </Modal>
      <SaveOutcomeDialog confirmLabel={dictionary.confirm} message={editor.outcome} onConfirm={onLeave} />
      <ConfirmDialog
        busy={editor.photoBusy}
        cancelLabel={dictionary.cancel}
        confirmLabel={editor.photoBusy ? dictionary.deleting : dictionary.delete}
        destructive
        message={dictionary.deletePhotoConfirmMessage}
        onCancel={() => editor.setConfirmingPhotoDelete(false)}
        onConfirm={editor.removePhoto}
        open={editor.confirmingPhotoDelete}
        title={dictionary.deletePhotoConfirmTitle}
      />
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
export function QuickThumb({ photoUrl, photoKey = null, siteId, dictionary }: { readonly photoUrl: string | null; readonly photoKey?: string | null; readonly siteId: ReturnType<typeof siteIdOf>; readonly dictionary: AppDictionary }) {
  return photoUrl !== null ? (
    <div className={styles.quickThumb}>
      <LinkImage
        alt={dictionary.representativePhoto}
        fallback={
          <span aria-hidden className={styles.quickThumbFallback}>
            <SiteIcon siteId={siteId} size={40} />
          </span>
        }
        cacheKey={photoKey}
        src={photoUrl}
      />
    </div>
  ) : (
    <span aria-hidden className={styles.quickSiteTile}>
      <SiteIcon siteId={siteId} size={32} />
    </span>
  );
}

/** The Collections the link is in - as staged (a change made in the dialog shows at once; it is saved with 저장). */
function ItemCollections({ state, selected, dictionary, onRetry }: { readonly state: ListState<CollectionSummary>; readonly selected: readonly CollectionSummary[]; readonly dictionary: AppDictionary; readonly onRetry: () => void }) {
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
  if (selected.length === 0) {
    return <span className={styles.stateMessage}>{dictionary.noCollection}</span>;
  }
  return (
    <ul className={styles.collectionChips}>
      {selected.map(collection => {
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
