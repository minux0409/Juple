'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { loadDestinations } from '../../../../lib/collectionDestinations';
import type { CollectionSummary } from '../../../../lib/collectionsView';
import { ownPhotoOf, representativePhotoKey, representativePhotoUrl, type ItemDetails, type ItemImage } from '../../../../lib/itemDetails';
import {
  applyItemMembershipChanges,
  imageUploadErrorMessage,
  imageUploadForm,
  isItemDraftDirty,
  isUploadableImage,
  itemDetailsBody,
  itemDetailsPath,
  itemImagePath,
  itemImageUploadPath,
  itemSaveErrorMessage,
  membershipDiff,
  mergeSelectedIntoDestinations,
} from '../../../../lib/itemEdit';
import { createPickerUnlockSession } from '../../../../lib/pickerUnlockSession';
import { saveOutcomeMessage } from '../../../../lib/newLink';
import { useSignedInApp } from '../../AppRoot';
import type { useItemRecord } from './useItemRecord';

const EMPTY_COLLECTIONS: readonly CollectionSummary[] = [];

/**
 * The editing of a link's details, on the details themselves (mobile ItemDetails: nothing opens a separate editor), on the same API
 * (lib/itemEdit.ts). The details view only draws what this holds:
 *
 *  - 제목 / 메모: untouched fields show what the server sent; typing keeps only what the person changed;
 *  - 컬렉션: a staged choice (null until the person changes it), picked in the Collection dialog and sent with 저장;
 *  - 대표 사진: immediate (one photo per link), never part of 저장;
 *  - 저장 sends the title / memo (one request), then the Collection changes (adds first, then removals). A part that fails is said,
 *    what went through stays, and the details stay open with what was typed - nothing is rolled back (neither does mobile).
 */
export function useItemEditor({
  itemId,
  record,
  onSaved,
}: {
  readonly itemId: number | null;
  readonly record: ReturnType<typeof useItemRecord>;
  /** Everything went through: the details are done (the sheet closes / the page leaves). */
  readonly onSaved: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const { state, setState, images, setImages, collections } = record;

  // ---- the draft -------------------------------------------------------------------------------------------------------------
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
  // The destination list is only needed once the Collection dialog is opened.
  const [wantDestinations, setWantDestinations] = useState(false);
  const loadDestinationsNow = useCallback(() => setWantDestinations(true), []);
  useEffect(() => {
    if (!wantDestinations) {
      return undefined;
    }
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
  }, [api, onSessionLost, wantDestinations]);
  // Every Collection the link is in is representable, even one the destination list does not offer (a view-only share).
  const options = useMemo(() => (destinations === null ? null : mergeSelectedIntoDestinations(destinations, memberships ?? EMPTY_COLLECTIONS)), [destinations, memberships]);
  const selectedIds = useMemo(() => new Set(selected.map(collection => collection.id)), [selected]);

  const detailsDirty = isItemDraftDirty({ title, memo }, baseline);
  const collectionsDirty = selected.length !== original.size || selected.some(collection => !original.has(collection.id));
  const isDirty = detailsDirty || collectionsDirty;

  // ---- photo (immediate, never part of 저장) ---------------------------------------------------------------------------------
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoBusyRef = useRef(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmingPhotoDelete, setConfirmingPhotoDelete] = useState(false);

  // ---- save ------------------------------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // The browser's own "leave this page?" question for a reload / closing the tab while there are unsaved edits - the standard,
  // stable hook only. Closing the sheet is guarded by the sheet itself (it asks before it goes).
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

  const imageList: readonly ItemImage[] =
    images.kind === 'loaded' ? images.items : loadedItem?.coverImage?.readUrl ? [{ id: loadedItem.coverImage.id ?? 0, readUrl: loadedItem.coverImage.readUrl }] : [];
  const ownPhoto = !loadedItem
    ? null
    : images.kind === 'loaded'
      ? ownPhotoOf(images.items, loadedItem.coverImage?.id)
      : loadedItem.coverImage?.id
        ? { id: loadedItem.coverImage.id, readUrl: loadedItem.coverImage.readUrl }
        : null;
  const photoUrl = loadedItem ? representativePhotoUrl(loadedItem.previewImageUrl, imageList, loadedItem.coverImage?.id) : null;
  const photoKey = loadedItem ? representativePhotoKey(imageList, loadedItem.coverImage?.id) : null;

  const setItem = (next: ItemDetails) => setState({ kind: 'loaded', item: next });

  const pickPhoto = (file: File | undefined) => {
    if (!file || !loadedItem || itemId === null || photoBusyRef.current) {
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
        setItem({ ...loadedItem, coverImage: uploaded.readUrl !== null ? { id: uploaded.id, readUrl: uploaded.readUrl } : null });
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
    if (!ownPhoto || !loadedItem || itemId === null || photoBusyRef.current) {
      return;
    }
    photoBusyRef.current = true;
    setPhotoBusy(true);
    setPhotoError(null);
    api<void>({ method: 'DELETE', path: itemImagePath(itemId, ownPhoto.id) }).then(
      () => {
        setImages({ kind: 'loaded', items: [] });
        setItem({ ...loadedItem, coverImage: null });
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
    if (savingRef.current || !isDirty || itemId === null) {
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
      onSaved();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return {
    title,
    setTitle: setDraftTitle,
    memo,
    setMemo: setDraftMemo,
    isDirty,
    // Collections
    selected,
    selectedIds,
    original,
    membershipsReady,
    options,
    destinationsFailed,
    wantDestinations,
    loadDestinationsNow,
    pickerSession,
    toggleCollection,
    onCreated: (created: CollectionSummary) => {
      // The new Collection is offered at once and chosen for this link (saved with 저장, like any other choice); what was chosen stays.
      setDestinations(previous => [created, ...(previous ?? []).filter(entry => entry.id !== created.id)]);
      setStaged(previous => {
        const base = previous ?? memberships ?? EMPTY_COLLECTIONS;
        return base.some(entry => entry.id === created.id) ? base : [...base, created];
      });
    },
    onRefreshed: (fresh: CollectionSummary) => {
      setDestinations(previous => (previous ? previous.map(entry => (entry.id === fresh.id ? fresh : entry)) : previous));
      setStaged(previous => (previous ?? selected).map(entry => (entry.id === fresh.id ? { ...entry, ...fresh } : entry)));
    },
    onUnavailable: (collectionId: number) => {
      setDestinations(previous => (previous ? previous.filter(entry => entry.id !== collectionId) : previous));
      setStaged(previous => (previous ?? selected).filter(entry => entry.id !== collectionId));
      setSettledIds(new Set([...original].filter(id => id !== collectionId)));
    },
    // Photo
    photoUrl,
    photoKey,
    ownPhoto,
    photoBusy,
    photoError,
    pickPhoto,
    removePhoto,
    confirmingPhotoDelete,
    setConfirmingPhotoDelete,
    // Save
    save,
    saving,
    saveError,
    outcome,
  };
}
