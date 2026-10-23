'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadDestinations } from '../../../../../lib/collectionDestinations';
import { isSessionLost } from '../../../../../lib/authSession';
import type { CollectionSummary } from '../../../../../lib/collectionsView';
import { createPickerUnlockSession } from '../../../../../lib/pickerUnlockSession';
import { ownPhotoOf, representativePhotoUrl, type ItemDetails, type ItemImage } from '../../../../../lib/itemDetails';
import {
  applyItemMembershipChanges,
  imageUploadErrorMessage,
  imageUploadForm,
  isItemDraftDirty,
  isRemovalOwnerOnly,
  isUploadableImage,
  itemContextSearch,
  itemDetailsBody,
  itemDetailsPath,
  itemImagePath,
  itemImageUploadPath,
  itemSaveErrorMessage,
  ITEM_IMAGE_ACCEPT,
  membershipDiff,
  mergeSelectedIntoDestinations,
} from '../../../../../lib/itemEdit';
import { notifyItemsChanged } from '../../../../../lib/itemChanges';
import { takeEditOpenedFromDetails } from '../../../../../lib/itemOverlay';
import { saveOutcomeMessage } from '../../../../../lib/newLink';
import { itemHref, parseRouteId } from '../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../AppRoot';
import { ItemCollectionsSection, ItemFormFooter, ItemFormLayout, ItemFormSections, ItemFormTop, ItemMemoSection } from '../../../ItemForm';
import { ConfirmDialog } from '../../../ConfirmDialog';
import { Glyph } from '../../../Glyph';
import { ItemPhoto, SourceRow } from '../../../ItemParts';
import { LoadFailed, Notice } from '../../../PageStates';
import { ItemDetailSkeleton } from '../../../Skeletons';
import { GatedLink } from '../GatedLink';
import { useItemRecord } from '../useItemRecord';
import { PageHeader } from '../../../PageHeader';
import { SaveOutcomeDialog } from '../../../SaveOutcomeDialog';
import styles from '../../../app.module.css';

const EMPTY_COLLECTIONS: readonly CollectionSummary[] = [];

/**
 * 링크 수정 - the mobile Item Details editing on one desktop page, on the same API (see lib/itemEdit.ts):
 *
 *  - left: the 대표 사진 and its management (사진 추가 / 변경 / 삭제 - immediate, one photo per link, as on mobile);
 *  - right: 제목, the link itself (read-only - mobile cannot change a saved URL), 메모 and 컬렉션 (search, about three rows, any
 *    number, 컬렉션 없음, locked ones after their password);
 *  - 저장 sends the title / memo (one request), then the Collection changes (adds first, then removals). A part that fails is said,
 *    what went through stays, and the page stays open with what was typed - nothing is rolled back (neither does mobile).
 */
export function ItemEditView({
  itemIdParam,
  lockedBy,
  fromCollectionId,
}: {
  readonly itemIdParam: string;
  readonly lockedBy: number | null;
  readonly fromCollectionId: number | null;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const itemId = parseRouteId(itemIdParam);
  const { state, setState, images, setImages, collections, reload, unlock } = useItemRecord(itemId, lockedBy);
  const detailsHref = itemId === null ? '/' : `${itemHref(itemId)}${itemContextSearch({ lockedBy, fromCollectionId })}`;

  // ---- the draft -------------------------------------------------------------------------------------------------------------
  // Untouched fields show what the server sent; typing keeps only what the person changed (no copy of the server's values).
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftMemo, setDraftMemo] = useState<string | null>(null);
  // What the last successful save wrote (so a later partial failure still compares against the truth).
  const [saved, setSaved] = useState<{ readonly title: string; readonly memo: string } | null>(null);
  const loadedItem = state.kind === 'loaded' ? state.item : null;
  const baseline = saved ?? { title: loadedItem?.title ?? '', memo: loadedItem?.memo ?? '' };
  const title = draftTitle ?? baseline.title;
  const memo = draftMemo ?? baseline.memo;

  // ---- the Collections -------------------------------------------------------------------------------------------------------
  const [pickerSession] = useState(createPickerUnlockSession);
  const [destinations, setDestinations] = useState<readonly CollectionSummary[] | null>(null);
  const [destinationsFailed, setDestinationsFailed] = useState(false);
  // The staged choice is null until the person changes it - then it is the server's current memberships, as loaded.
  const memberships = collections.kind === 'loaded' ? collections.items : null;
  const [staged, setStaged] = useState<readonly CollectionSummary[] | null>(null);
  const [settledIds, setSettledIds] = useState<ReadonlySet<number> | null>(null);
  const selected = staged ?? memberships ?? EMPTY_COLLECTIONS;
  const original = useMemo<ReadonlySet<number>>(() => settledIds ?? new Set((memberships ?? []).map(collection => collection.id)), [settledIds, memberships]);
  const membershipsReady = memberships !== null;
  useEffect(() => {
    let ignore = false;
    loadDestinations(api).then(
      loaded => {
        if (!ignore) {
          setDestinations(loaded);
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setDestinationsFailed(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost]);
  // Every Collection the link is in is representable, even one the destination list does not offer (a view-only share).
  const options = useMemo(() => (destinations === null ? null : mergeSelectedIntoDestinations(destinations, memberships ?? EMPTY_COLLECTIONS)), [destinations, memberships]);
  const selectedIds = useMemo(() => new Set(selected.map(collection => collection.id)), [selected]);

  const detailsDirty = isItemDraftDirty({ title, memo }, baseline);
  const collectionsDirty = selected.length !== original.size || selected.some(collection => !original.has(collection.id));
  const isDirty = detailsDirty || collectionsDirty;

  // ---- photo (immediate, never part of 저장) ---------------------------------------------------------------------------------
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoBusyRef = useRef(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmingPhotoDelete, setConfirmingPhotoDelete] = useState(false);

  // ---- save / leave ----------------------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // The browser's own "leave this page?" question for a reload / closing the tab while there are unsaved edits - the standard,
  // stable hook only. In-app navigation is guarded by this page's own 취소 / 뒤로.
  useEffect(() => {
    if (!isDirty) {
      return undefined;
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  // Back to the details the editor was opened from (the sheet over a list, or the standalone page): they read the link again, and the
  // lists under them are told it changed. Opened any other way (the address typed or reloaded) there is nothing to go back to, so the
  // details are opened as a page.
  const goToDetails = () => {
    if (itemId !== null) {
      notifyItemsChanged({ kind: 'updated', itemId });
    }
    if (takeEditOpenedFromDetails()) {
      router.back();
    } else {
      window.location.replace(detailsHref);
    }
  };
  const requestLeave = () => {
    if (isDirty && !savingRef.current) {
      setConfirmingLeave(true);
      return;
    }
    goToDetails();
  };

  const backButton = (
    <button className={styles.backButton} onClick={requestLeave} type="button">
      <Glyph className={styles.backIcon} name="Chevron" size={18} />
      <span>{dictionary.back}</span>
    </button>
  );

  if (state.kind === 'notFound' || itemId === null) {
    return (
      <section className={styles.page}>
        {backButton}
        <Notice message={dictionary.itemLoadFailed} />
      </section>
    );
  }
  if (state.kind === 'loading') {
    return (
      <section aria-busy className={styles.page}>
        {backButton}
        <ItemDetailSkeleton />
      </section>
    );
  }
  if (state.kind === 'failed') {
    return (
      <section className={styles.page}>
        {backButton}
        <LoadFailed dictionary={dictionary} message={dictionary.itemLoadFailed} onRetry={reload} />
      </section>
    );
  }
  if (state.kind === 'gated' && lockedBy !== null) {
    return (
      <section className={styles.page}>
        {backButton}
        <GatedLink collectionId={lockedBy} gate={state.gate} onGranted={unlock} onStateChanged={reload} />
      </section>
    );
  }
  if (state.kind !== 'loaded') {
    return null;
  }

  const { item } = state;
  const imageList: readonly ItemImage[] = images.kind === 'loaded' ? images.items : item.coverImage?.readUrl ? [{ id: item.coverImage.id ?? 0, readUrl: item.coverImage.readUrl }] : [];
  const ownPhoto = images.kind === 'loaded' ? ownPhotoOf(images.items, item.coverImage?.id) : item.coverImage?.id ? { id: item.coverImage.id, readUrl: item.coverImage.readUrl } : null;
  const photoUrl = representativePhotoUrl(item.previewImageUrl, imageList, item.coverImage?.id);

  const setItem = (next: ItemDetails) => setState({ kind: 'loaded', item: next });

  const pickPhoto = (file: File | undefined) => {
    if (fileInput.current) {
      fileInput.current.value = '';
    }
    if (!file || photoBusyRef.current) {
      return;
    }
    if (!isUploadableImage(file)) {
      setPhotoError(dictionary.imageUploadInvalid);
      return;
    }
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    api<ItemImage>({ method: 'POST', path: itemImageUploadPath(itemId), body: imageUploadForm(file, file.name || 'upload') }).then(
      uploaded => {
        // The server's answer is the whole truth about the photo now: this one, as the cover (its read URL is new).
        setImages({ kind: 'loaded', items: [uploaded] });
        setItem({ ...item, coverImage: uploaded.readUrl !== null ? { id: uploaded.id, readUrl: uploaded.readUrl } : null });
        photoBusyRef.current = false;
        setPhotoBusy(false);
      },
      caught => {
        photoBusyRef.current = false;
        setPhotoBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        // The previous photo (or none) stays exactly as it was.
        setPhotoError(imageUploadErrorMessage(caught, dictionary));
      },
    );
  };

  const removePhoto = () => {
    if (!ownPhoto || photoBusyRef.current) {
      return;
    }
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    api<void>({ method: 'DELETE', path: itemImagePath(itemId, ownPhoto.id) }).then(
      () => {
        setImages({ kind: 'loaded', items: [] });
        setItem({ ...item, coverImage: null });
        photoBusyRef.current = false;
        setPhotoBusy(false);
        setConfirmingPhotoDelete(false);
      },
      caught => {
        photoBusyRef.current = false;
        setPhotoBusy(false);
        setConfirmingPhotoDelete(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setPhotoError(dictionary.imageDeleteFailed);
      },
    );
  };

  const toggleCollection = (collection: CollectionSummary) => {
    setStaged(previous => {
      const base = previous ?? memberships ?? EMPTY_COLLECTIONS;
      return base.some(entry => entry.id === collection.id) ? base.filter(entry => entry.id !== collection.id) : [...base, collection];
    });
  };

  const save = async () => {
    // One save at a time - a second click while the first runs is the same click.
    if (savingRef.current || !isDirty) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      if (detailsDirty) {
        try {
          await api<void>({ method: 'PUT', path: itemDetailsPath(itemId), body: itemDetailsBody(title, memo) });
          setSaved({ title, memo });
        } catch (caught) {
          if (isSessionLost(caught)) {
            onSessionLost();
            return;
          }
          // The typed values stay; the Collection changes are not attempted on top of a failed save.
          setSaveError(itemSaveErrorMessage(caught, dictionary));
          return;
        }
      }
      if (collectionsDirty) {
        const { toAdd, toRemoveIds } = membershipDiff(original, selected);
        let result;
        try {
          result = await applyItemMembershipChanges(api, itemId, toAdd, toRemoveIds, collectionId => pickerSession.tokenFor(collectionId), dictionary);
        } catch (caught) {
          if (isSessionLost(caught)) {
            onSessionLost();
            return;
          }
          setSaveError(dictionary.membershipError);
          return;
        }
        // What went through stays (and is the new baseline); a proposal is not a membership, a settled one needs nothing more.
        const nextOriginal = new Set(original);
        result.addedIds.forEach(id => nextOriginal.add(id));
        result.removedIds.forEach(id => nextOriginal.delete(id));
        setSettledIds(nextOriginal);
        if (result.proposedIds.length > 0 || result.settledIds.length > 0) {
          // Not memberships and not retryable: they are no longer part of the staged choice.
          const dropped = new Set([...result.proposedIds, ...result.settledIds]);
          setStaged(previous => (previous ?? selected).filter(collection => !dropped.has(collection.id)));
        }
        if (result.failureMessages.length > 0) {
          setSaveError(result.failureMessages.join('\n'));
          return;
        }
        if (result.proposedIds.length > 0) {
          setOutcome(
            saveOutcomeMessage(
              { addedCount: result.addedIds.length, submittedCount: result.proposedIds.length, alreadyPendingCount: 0, alreadyInCollectionCount: 0 },
              dictionary,
            ) ?? dictionary.saveOutcomeSaved,
          );
          return;
        }
      }
      goToDetails();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className={styles.page}>
      {backButton}
      <PageHeader bell={false} title={dictionary.edit} />
      <ItemFormLayout onSubmit={() => void save()}>
        <ItemFormTop
          media={
            <>
              <ItemPhoto dictionary={dictionary} photoUrl={photoUrl} url={item.url} />
              <div className={styles.photoActions}>
                <input accept={ITEM_IMAGE_ACCEPT} aria-label={dictionary.addPhoto} hidden onChange={event => pickPhoto(event.target.files?.[0])} ref={fileInput} type="file" />
                <button className={styles.settingsAction} disabled={photoBusy} onClick={() => fileInput.current?.click()} type="button">
                  <Glyph name="Image" size={16} />
                  {photoBusy ? dictionary.uploading : ownPhoto ? dictionary.changePhoto : dictionary.addPhoto}
                </button>
                {ownPhoto ? (
                  <button className={styles.dangerAction} disabled={photoBusy} onClick={() => setConfirmingPhotoDelete(true)} type="button">
                    <Glyph name="Trash" size={16} />
                    {dictionary.removePhoto}
                  </button>
                ) : null}
              </div>
              {photoError ? (
                <p className={styles.fieldError} role="alert">
                  {photoError}
                </p>
              ) : null}
            </>
          }
        >
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{dictionary.titleLabel}</span>
            <input className={styles.textInput} dir="auto" onChange={event => setDraftTitle(event.target.value)} placeholder={dictionary.titlePlaceholder} value={title} />
          </label>
          <SourceRow url={item.url} />
        </ItemFormTop>

        <ItemFormSections>
          <ItemCollectionsSection
            clearable
            destinations={membershipsReady ? options : null}
            failed={destinationsFailed || collections.kind === 'failed'}
            isDeselectBlocked={collection => original.has(collection.id) && isRemovalOwnerOnly(collection)}
            noneSelected={selected.length === 0}
            onCreated={created => {
              // The new Collection is offered at once and chosen for this link (saved with 저장, like any other choice); what was chosen stays.
              setDestinations(previous => [created, ...(previous ?? []).filter(entry => entry.id !== created.id)]);
              setStaged(previous => {
                const base = previous ?? memberships ?? EMPTY_COLLECTIONS;
                return base.some(entry => entry.id === created.id) ? base : [...base, created];
              });
            }}
            onRefreshed={fresh => {
              setDestinations(previous => (previous ? previous.map(entry => (entry.id === fresh.id ? fresh : entry)) : previous));
              setStaged(previous => (previous ?? selected).map(entry => (entry.id === fresh.id ? { ...entry, ...fresh } : entry)));
            }}
            onToggle={toggleCollection}
            onUnavailable={collectionId => {
              setDestinations(previous => (previous ? previous.filter(entry => entry.id !== collectionId) : previous));
              setStaged(previous => (previous ?? selected).filter(entry => entry.id !== collectionId));
              setSettledIds(new Set([...original].filter(id => id !== collectionId)));
            }}
            selectedIds={selectedIds}
            session={pickerSession}
          />
          <ItemMemoSection onChange={setDraftMemo} value={memo} />

          {saveError ? (
            <div className={styles.fieldError} role="alert">
              {saveError.split('\n').map(line => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}
          {outcome ? null : (
            <ItemFormFooter>
              <button className={styles.settingsAction} disabled={saving} onClick={requestLeave} type="button">
                {dictionary.cancel}
              </button>
              <button className={styles.primaryAction} disabled={saving || !isDirty} type="submit">
                {saving ? dictionary.saving : dictionary.save}
              </button>
            </ItemFormFooter>
          )}
        </ItemFormSections>
      </ItemFormLayout>
      <SaveOutcomeDialog confirmLabel={dictionary.confirm} message={outcome} onConfirm={goToDetails} />

      <ConfirmDialog
        busy={photoBusy}
        cancelLabel={dictionary.cancel}
        confirmLabel={photoBusy ? dictionary.deleting : dictionary.delete}
        destructive
        message={dictionary.deletePhotoConfirmMessage}
        onCancel={() => setConfirmingPhotoDelete(false)}
        onConfirm={removePhoto}
        open={confirmingPhotoDelete}
        title={dictionary.deletePhotoConfirmTitle}
      />
      <ConfirmDialog
        cancelLabel={dictionary.continueEditing}
        confirmLabel={dictionary.leave}
        destructive
        message={dictionary.unsavedChangesMessage}
        onCancel={() => setConfirmingLeave(false)}
        onConfirm={() => {
          setConfirmingLeave(false);
          goToDetails();
        }}
        open={confirmingLeave}
        title={dictionary.unsavedChangesTitle}
      />
    </section>
  );
}
