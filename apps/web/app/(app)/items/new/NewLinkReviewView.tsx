'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiHttpError } from '../../../../lib/appApi';
import { isSessionLost } from '../../../../lib/authSession';
import { canAddItemsTo } from '../../../../lib/collectionEditor';
import { isCollectionLocked, type CollectionSummary, type CollectionsPage } from '../../../../lib/collectionsView';
import {
  COLLECTION_SHARE_URL_NOT_SAVABLE_CODE,
  isHttpUrl,
  publicIdFromShareUrl,
  saveErrorMessage,
  saveInboxEntryBody,
  saveOutcomeMessage,
  usableMetadataTitle,
  type ResolvedUrlMetadata,
  type SavedInboxEntry,
} from '../../../../lib/newLink';
import { isSafeHttpUrl } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { CollectionTileView } from '../../collections/CollectionsView';
import { COLLECTION_SEARCH_DEBOUNCE_MS, filterCollectionsByName } from '../../../../lib/collectionPicker';
import { Glyph } from '../../Glyph';
import { ItemPhoto, SourceRow } from '../../ItemParts';
import { BackButton, Notice } from '../../PageStates';
import { CollectionSkeleton } from '../../Skeletons';
import styles from '../../app.module.css';

/** The destinations offered (mobile useCategoryPickerModal): mine, then the shared ones I may add to; all pages. */
async function loadDestinations(api: ReturnType<typeof useSignedInApp>['api']): Promise<readonly CollectionSummary[]> {
  const drain = async (scope: 'owned' | 'shared') => {
    let all: readonly CollectionSummary[] = [];
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ scope, limit: '50' });
      if (cursor) {
        query.set('cursor', cursor);
      }
      const page: CollectionsPage = await api<CollectionsPage>({ path: `/api/v1/collections?${query.toString()}` });
      all = [...all, ...page.items];
      cursor = page.nextCursor;
    } while (cursor);
    return all;
  };
  const owned = await drain('owned');
  const ownedIds = new Set(owned.map(collection => collection.id));
  const shared = (await drain('shared')).filter(collection => !ownedIds.has(collection.id) && canAddItemsTo(collection));
  return [...owned, ...shared];
}

/**
 * 새 링크 검토 - the mobile NewLinkReviewScreen for a link typed on Home: the link (exactly what will be saved), the title the server
 * found (or the person's own; never guessed), where it goes (any number of Collections, or explicitly 선택 안 함 - Save waits for that
 * decision), a memo, and the preview image the server found. Save creates the link once; a retry of the same link replays it.
 */
export function NewLinkReviewView({ url }: { readonly url: string }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const valid = isHttpUrl(url);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(valid);
  const [metadataFailed, setMetadataFailed] = useState(false);
  const [destinations, setDestinations] = useState<readonly CollectionSummary[] | null>(null);
  const [destinationsFailed, setDestinationsFailed] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [noneChosen, setNoneChosen] = useState(false);
  // 컬렉션 검색 (Web only - the mobile picker has none, and the list API has no search): narrows the already-loaded list by name a
  // moment after typing pauses. It never changes what is selected - a chosen Collection hidden by the search stays chosen.
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAppliedQuery(query), COLLECTION_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  // Stable across retries of this link (the server replays the already-created Item instead of creating a second one).
  const clientRequestId = useRef<string | null>(null);
  // The person typed their own title before the server answered: theirs stays.
  const titleTouched = useRef(false);

  useEffect(() => {
    if (!valid) {
      return undefined;
    }
    let ignore = false;
    api<ResolvedUrlMetadata>({ method: 'POST', path: '/api/v1/url-metadata/resolve', body: { url } }).then(
      metadata => {
        if (ignore) {
          return;
        }
        const found = usableMetadataTitle(url, metadata.title);
        if (found && !titleTouched.current) {
          setTitle(found);
        }
        setPreviewImageUrl(isSafeHttpUrl(metadata.previewImageUrl) ? metadata.previewImageUrl : null);
        setIsResolving(false);
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setMetadataFailed(true);
        setIsResolving(false);
      },
    );
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
  }, [api, onSessionLost, url, valid]);

  const back = <BackButton dictionary={dictionary} fallbackHref="/" />;
  if (!valid) {
    return (
      <section className={styles.page}>
        {back}
        <Notice message={dictionary.inboxErrorBadRequest} />
      </section>
    );
  }

  const hasDecision = noneChosen || selected.size > 0;
  const toggle = (collection: CollectionSummary) => {
    setNoneChosen(false);
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(collection.id)) {
        next.delete(collection.id);
      } else {
        next.add(collection.id);
      }
      return next;
    });
  };

  const save = async () => {
    if (isSaving || !hasDecision) {
      return;
    }
    clientRequestId.current ??= crypto.randomUUID();
    setIsSaving(true);
    setError(null);
    try {
      const saved = await api<SavedInboxEntry>({ method: 'POST', path: '/api/v1/inbox', body: saveInboxEntryBody(url, clientRequestId.current, noneChosen ? [] : [...selected]) });
      const trimmedTitle = title.trim();
      const trimmedMemo = memo.trim();
      if (trimmedTitle || trimmedMemo) {
        await api<void>({ method: 'PUT', path: `/api/v1/items/${saved.id}/details`, body: { title: trimmedTitle, memo: trimmedMemo } });
      }
      // Best effort, as on mobile: the server's own preview image for this link - never blocks the save.
      if (previewImageUrl) {
        await api<void>({ method: 'PUT', path: `/api/v1/items/${saved.id}/preview-image`, body: { previewImageUrl } }).catch(() => undefined);
      }
      const message = saveOutcomeMessage(saved, dictionary);
      if (message) {
        setOutcome(message);
        setIsSaving(false);
        return;
      }
      router.replace('/');
    } catch (caught) {
      setIsSaving(false);
      if (isSessionLost(caught)) {
        onSessionLost();
        return;
      }
      // A Juple Collection share link is never saved as an ordinary link: it opens the Collection instead.
      if (caught instanceof ApiHttpError && caught.status === 400 && caught.code === COLLECTION_SHARE_URL_NOT_SAVABLE_CODE) {
        const publicId = publicIdFromShareUrl(url);
        if (publicId) {
          router.replace(`/c/${encodeURIComponent(publicId)}`);
          return;
        }
        setError(dictionary.collectionLinkNotSavable);
        return;
      }
      setError(saveErrorMessage(caught, dictionary));
    }
  };

  return (
    <section className={styles.page}>
      {back}
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{dictionary.reviewTitle}</h1>
      </div>
      <div className={styles.reviewTop}>
        <ItemPhoto dictionary={dictionary} photoUrl={previewImageUrl} url={url} />
        <div className={styles.itemInfo}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{dictionary.titleLabel}</span>
            <input
              className={styles.textInput}
              dir="auto"
              onChange={event => {
                titleTouched.current = true;
                setTitle(event.target.value);
              }}
              placeholder={isResolving ? dictionary.processing : dictionary.titlePlaceholder}
              value={title}
            />
          </label>
          {metadataFailed ? <p className={styles.stateMessage}>{dictionary.metadataFailedHint}</p> : null}
          <SourceRow url={url} />
        </div>
      </div>

      {/* Where it goes - full width under the link, a compact grid however many Collections there are; 선택 안 함 first. */}
      <div className={styles.reviewSections}>
        <fieldset className={styles.reviewSection}>
          <legend className={styles.fieldLabel}>{dictionary.collectionsLabel}</legend>
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
          {destinationsFailed ? <p className={styles.fieldError}>{dictionary.loadFailedTitle}</p> : null}
          {/* About three rows are visible; the rest scrolls inside this box (focusable, so the keyboard can scroll it too). */}
          <div aria-busy={destinations === null} aria-label={dictionary.collectionsLabel} className={styles.pickerScroll} role="group" tabIndex={0}>
            {destinations === null && !destinationsFailed ? <CollectionSkeleton count={6} mode="grid" /> : null}
            <div className={styles.choiceList}>
              <button aria-pressed={noneChosen} className={noneChosen ? styles.choiceSelected : styles.choice} onClick={() => {
                setNoneChosen(true);
                setSelected(new Set());
              }} type="button">
                <span className={styles.choiceNone}>
                  <Glyph name="Folder" size={18} />
                </span>
                <span>{dictionary.collectionNone}</span>
              </button>
              {filterCollectionsByName(destinations ?? [], appliedQuery).map(collection => {
                const locked = isCollectionLocked(collection);
                return (
                  <button
                    aria-pressed={selected.has(collection.id)}
                    className={selected.has(collection.id) ? styles.choiceSelected : styles.choice}
                    disabled={locked}
                    key={collection.id}
                    onClick={() => toggle(collection)}
                    title={locked ? dictionary.collectionLockedWebMessage : undefined}
                    type="button"
                  >
                    <CollectionTileView collection={collection} size={26} />
                    <span className={styles.choiceName} dir="auto">
                      {collection.name}
                    </span>
                    {locked ? <Glyph name="Lock" size={14} /> : null}
                  </button>
                );
              })}
            </div>
            {destinations !== null && appliedQuery.trim() && filterCollectionsByName(destinations, appliedQuery).length === 0 ? (
              <p className={styles.pickerEmpty}>{dictionary.searchEmpty}</p>
            ) : null}
          </div>
        </fieldset>

        <label className={styles.reviewSection}>
          <span className={styles.fieldLabel}>{dictionary.memo}</span>
          <textarea className={styles.textArea} dir="auto" onChange={event => setMemo(event.target.value)} placeholder={dictionary.memoPlaceholder} rows={3} value={memo} />
        </label>

        {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
        {outcome ? (
          <div className={styles.inlineState} role="status">
            {outcome.split('\n').map(line => (
              <p className={styles.stateMessage} key={line}>{line}</p>
            ))}
            <button className={styles.secondaryButton} onClick={() => router.replace('/')} type="button">
              {dictionary.confirm}
            </button>
          </div>
        ) : (
          <div className={styles.reviewFooter}>
            <button className={styles.primaryAction} disabled={!hasDecision || isSaving} onClick={() => void save()} type="button">
              {isSaving ? dictionary.saving : dictionary.save}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
