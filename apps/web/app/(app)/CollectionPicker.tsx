'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isSessionLost } from '../../lib/authSession';
import { resolveFreshCollectionAccess } from '../../lib/collectionDestinations';
import { createCollection } from '../../lib/collectionEditor';
import { collectionContentGate, type CollectionContentGate } from '../../lib/collectionGate';
import { COLLECTION_SEARCH_DEBOUNCE_MS, filterCollectionsByName } from '../../lib/collectionPicker';
import { isSharedWithMe } from '../../lib/collectionSharing';
import { isCollectionLocked, type CollectionSummary } from '../../lib/collectionsView';
import type { PickerUnlockSession } from '../../lib/pickerUnlockSession';
import { useSignedInApp } from './AppRoot';
import { UnlockPanel } from './collections/[collectionId]/UnlockPanel';
import { NewCollectionDialog } from './collections/NewCollectionDialog';
import { CollectionTileView } from './collections/CollectionsView';
import { Glyph } from './Glyph';
import { PasswordDialog } from './PasswordDialog';
import { ViewModeToggle } from './ViewModeToggle';
import { CollectionSkeleton } from './Skeletons';
import styles from './app.module.css';

const PICKER_VIEW_MODES = ['list', 'grid'] as const;

interface Pending {
  readonly collection: CollectionSummary;
  readonly gate: CollectionContentGate;
}

/**
 * The Collection picker shared by the new-link review and the link editor (mobile CategoryPickerModal + useCategoryPickerModal):
 * 컬렉션 검색 (a filter of what is loaded), about three rows with an internal scroll, any number chosen, the explicit "none" choice
 * where the caller wants one, and locked Collections that can be chosen like any other - after their password.
 *
 *  - Choosing OR un-choosing a locked Collection changes its content, so it asks first - unless this picker session already
 *    unlocked it. Whether it is locked is read from the server at THIS tap (never the list loaded earlier).
 *  - Which password it asks for follows the Collection's role for the caller: the Owner's lock, or a member's access password.
 *  - The grant stays in the caller's PickerUnlockSession (memory of this page only) and is never the Collection-visit store.
 *  - The picker holds no selection state of its own: `selectedIds` / `onToggle` belong to the screen, as on mobile.
 */
export function CollectionPicker({
  destinations,
  failed,
  selectedIds,
  noneSelected,
  onNone,
  clearable,
  onToggle,
  session,
  isDeselectBlocked,
  onUnavailable,
  onRefreshed,
  onCreated,
  viewModes,
}: {
  /** Null while loading. */
  readonly destinations: readonly CollectionSummary[] | null;
  readonly failed: boolean;
  readonly selectedIds: ReadonlySet<number>;
  /** The "no Collection" choice, shown first when `onNone` or `clearable` is given; whether it is chosen is the caller's state. */
  readonly noneSelected?: boolean;
  /** The review's explicit decision: the caller clears its own selection. */
  readonly onNone?: () => void;
  /** The editor's choice: takes the link out of every chosen Collection, one after another, each locked one after its password. */
  readonly clearable?: boolean;
  /** Called once a choice may go ahead (unlocked or not locked): add the Collection when it is not selected, else remove it. */
  readonly onToggle: (collection: CollectionSummary) => void;
  readonly session: PickerUnlockSession;
  /** A Collection the link is in that only another person (its Owner) may take it out of: shown as chosen, not removable. */
  readonly isDeselectBlocked?: (collection: CollectionSummary) => boolean;
  /** The Collection is gone for the caller (or now view-only): the caller drops it from its list and its staged choice. */
  readonly onUnavailable: (collectionId: number) => void;
  /** The server's current card for a Collection that was just read again. */
  readonly onRefreshed: (collection: CollectionSummary) => void;
  /**
   * Gives the picker a "+ 새 컬렉션" (mobile CategoryPickerModal.onCreateCollection): the Collection editor in a dialog, the same create
   * request as the Collections page. Called once with the created Collection, which the caller adds to its list and selects.
   */
  readonly onCreated?: (collection: CollectionSummary) => void;
  /**
   * Adds the List | Grid switch (mobile's picker toggle) beside the search: List = one compact row per Collection, Grid = icon / photo
   * tiles with the name underneath. Kept for this opening of the picker only - nothing is stored. Absent = the picker as it was.
   */
  readonly viewModes?: boolean;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query), COLLECTION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ readonly error: string | null; readonly busy: boolean; readonly host: Element } | null>(null);
  // Collections whose current state is being read right now: a second tap on one is the same tap, never a second action.
  const resolving = useRef(new Set<number>());
  const pendingToggle = useRef<{ readonly collection: CollectionSummary; readonly settle: (ok: boolean) => void } | null>(null);

  const commit = (collection: CollectionSummary) => {
    setNotice(null);
    onToggle(collection);
  };

  /** Resolves true when the choice went ahead, false when it did not (cancelled, unavailable, offline). */
  const requestToggle = (collection: CollectionSummary): Promise<boolean> =>
    new Promise<boolean>(settle => {
      if (resolving.current.has(collection.id)) {
        settle(false);
        return;
      }
      if (selectedIds.has(collection.id) && isDeselectBlocked?.(collection)) {
        setNotice(dictionary.removeFromSharedOwnerOnly);
        settle(false);
        return;
      }
      resolving.current.add(collection.id);
      resolveFreshCollectionAccess(api, collection)
        .then(result => {
          if (result.status === 'unavailable') {
            onUnavailable(collection.id);
            setNotice(dictionary.pickerCollectionUnavailable);
            settle(false);
            return;
          }
          // The server's card when it answered; the cached one only when it could not be reached.
          const current = result.status === 'ok' ? { ...collection, ...result.collection } : collection;
          if (result.status === 'ok') {
            onRefreshed(current);
          }
          const gate = result.status === 'ok' ? result.gate : collectionContentGate(collection);
          if (gate === null || session.isUnlocked(collection.id)) {
            commit(current);
            settle(true);
            return;
          }
          pendingToggle.current = { collection: current, settle };
          setPending({ collection: current, gate });
        })
        .catch(caught => {
          settle(false);
          if (isSessionLost(caught)) {
            onSessionLost();
          }
        })
        .finally(() => {
          resolving.current.delete(collection.id);
        });
    });

  const closePrompt = () => {
    const waiting = pendingToggle.current;
    pendingToggle.current = null;
    setPending(null);
    waiting?.settle(false);
  };

  const finishPrompt = () => {
    const waiting = pendingToggle.current;
    pendingToggle.current = null;
    setPending(null);
    if (waiting) {
      commit(waiting.collection);
      waiting.settle(true);
    }
  };

  /** The password asked for no longer exists (removed meanwhile): the Collection is read again and the tap goes on from the truth. */
  const onStateChanged = () => {
    const target = pending?.collection;
    if (!target) {
      return;
    }
    resolveFreshCollectionAccess(api, target).then(
      result => {
        if (result.status === 'unavailable') {
          closePrompt();
          onUnavailable(target.id);
          setNotice(dictionary.pickerCollectionUnavailable);
          return;
        }
        if (result.status === 'unknown') {
          return;
        }
        const current = { ...target, ...result.collection };
        onRefreshed(current);
        if (pendingToggle.current) {
          pendingToggle.current = { ...pendingToggle.current, collection: current };
        }
        if (result.gate === null) {
          finishPrompt();
          return;
        }
        // Still (or now differently) protected: the prompt continues with the CURRENT kind of password.
        setPending({ collection: current, gate: result.gate });
      },
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
        }
      },
    );
  };

  /** 컬렉션 없음 in the editor (mobile clearItemCollectionSelection): one after another through the same per-Collection check. */
  const clearSelection = async () => {
    const chosen = (destinations ?? []).filter(collection => selectedIds.has(collection.id));
    if (chosen.some(collection => isDeselectBlocked?.(collection))) {
      setNotice(dictionary.removeFromSharedOwnerOnly);
    }
    for (const collection of chosen.filter(entry => !isDeselectBlocked?.(entry))) {
      // Cancelling a password stops here, leaving the rest as they were.
      if (!(await requestToggle(collection))) {
        break;
      }
    }
  };

  const submitNew = (draft: Parameters<typeof createCollection>[1]) => {
    setCreating(previous => (previous ? { ...previous, error: null, busy: true } : previous));
    createCollection(api, draft, dictionary).then(outcome => {
      if (outcome.ok) {
        setCreating(null);
        // A photo that could not be saved leaves the Collection with its icon and says why (as on the Collections page).
        setNotice(outcome.warning);
        onCreated?.(outcome.collection);
        return;
      }
      if (isSessionLost(outcome.error)) {
        onSessionLost();
        return;
      }
      setCreating(previous => (previous ? { ...previous, error: outcome.message, busy: false } : previous));
    });
  };

  const visible = filterCollectionsByName(destinations ?? [], appliedQuery);

  return (
    <div className={styles.collectionPicker}>
      <div className={viewModes ? styles.pickerToolbar : undefined}>
        <div className={styles.pickerSearch}>
          <Glyph className={styles.pickerSearchIcon} name="Search" size={16} />
          <input
            aria-label={dictionary.collectionSearchPlaceholder}
            className={styles.textInput}
            dir="auto"
            onChange={event => setQuery(event.target.value)}
            placeholder={dictionary.collectionSearchPlaceholder}
            type="search"
            value={query}
          />
          {query ? (
            <button aria-label={dictionary.searchClear} className={styles.pickerClear} onClick={() => setQuery('')} title={dictionary.searchClear} type="button">
              ×
            </button>
          ) : null}
        </div>
        {viewModes ? (
          <ViewModeToggle
            groupLabel={dictionary.viewModeLabel}
            labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }}
            modes={PICKER_VIEW_MODES}
            onChange={setLayout}
            value={layout}
          />
        ) : null}
      </div>
      {failed ? <p className={styles.fieldError}>{dictionary.loadFailedTitle}</p> : null}
      {notice ? (
        <p className={styles.fieldError} role="status">
          {notice}
        </p>
      ) : null}
      {/* About three rows are visible; the rest scrolls inside this box (focusable, so the keyboard can scroll it too). */}
      <div aria-busy={destinations === null} aria-label={dictionary.collectionsLabel} className={styles.pickerScroll} role="group" tabIndex={0}>
        {destinations === null && !failed ? <CollectionSkeleton count={6} mode="grid" /> : null}
        <div className={`${styles.choiceList} ${viewModes ? (layout === 'grid' ? styles.choiceGridTiles : styles.choiceListRows) : ''}`} data-picker-layout={viewModes ? layout : undefined}>
          {onNone || clearable ? (
            <button
              aria-pressed={noneSelected === true}
              className={noneSelected ? styles.choiceSelected : styles.choice}
              onClick={() => (onNone ? onNone() : void clearSelection())}
              type="button"
            >
              <span className={styles.choiceNone}>
                <Glyph name="Folder" size={18} />
              </span>
              <span>{dictionary.collectionNone}</span>
            </button>
          ) : null}
          {onCreated ? (
            <button className={`${styles.choice} ${styles.choiceCreate}`} data-collection-create onClick={event => setCreating({ error: null, busy: false, host: event.currentTarget.closest('main') ?? document.body })} type="button">
              <span className={styles.choiceNone}>
                <Glyph name="Plus" size={18} />
              </span>
              <span>{dictionary.collectionCreate}</span>
            </button>
          ) : null}
          {visible.map(collection => {
            const selected = selectedIds.has(collection.id);
            return (
              <button
                aria-pressed={selected}
                className={`${selected ? styles.choiceSelected : styles.choice}${viewModes && layout === 'grid' ? ` ${styles.choiceTile}` : ''}`}
                key={collection.id}
                onClick={() => void requestToggle(collection)}
                type="button"
              >
                <CollectionTileView collection={collection} size={48} />
                <span className={styles.choiceName} dir="auto">
                  {collection.name}
                </span>
                {isCollectionLocked(collection) ? <Glyph name="Lock" size={14} /> : null}
              </button>
            );
          })}
        </div>
        {destinations !== null && appliedQuery.trim() && visible.length === 0 ? <p className={styles.pickerEmpty}>{dictionary.searchEmpty}</p> : null}
      </div>
      {/* Drawn in <main> (it carries the colour tokens), NOT inside the link's <form>: a form nested in a form never submits on its own
          (the browser sends the outer one). React events still bubble through a portal, so the dialog's submit is stopped before it can
          save the link. */}
      {onCreated && creating !== null
        ? createPortal(
            <NewCollectionDialog busy={creating.busy} dictionary={dictionary} error={creating.error} onClose={() => setCreating(null)} onSubmit={submitNew} />,
            creating.host,
          )
        : null}
      <PasswordDialog cancelLabel={dictionary.cancel} onCancel={closePrompt} open={pending !== null}>
        {pending ? (
          <UnlockPanel
            collectionId={pending.collection.id}
            isOwner={!isSharedWithMe(pending.collection)}
            key={`${pending.collection.id}-${pending.gate}`}
            kind={pending.gate}
            onGranted={grant => session.remember(pending.collection.id, grant)}
            onStateChanged={onStateChanged}
            onUnlocked={finishPrompt}
          />
        ) : null}
      </PasswordDialog>
    </div>
  );
}
