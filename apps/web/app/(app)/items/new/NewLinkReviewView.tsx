'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiHttpError } from '../../../../lib/appApi';
import { isSessionLost } from '../../../../lib/authSession';
import { loadDestinations } from '../../../../lib/collectionDestinations';
import type { CollectionSummary } from '../../../../lib/collectionsView';
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
import { createPickerUnlockSession, unlockTokensFor } from '../../../../lib/pickerUnlockSession';
import { ItemCollectionsSection, ItemFormFooter, ItemFormLayout, ItemFormSections, ItemFormTop, ItemMemoSection } from '../../ItemForm';
import { ItemPhoto, SourceRow } from '../../ItemParts';
import { BackButton, Notice } from '../../PageStates';
import { PageHeader } from '../../PageHeader';
import styles from '../../app.module.css';

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
  // The Collections unlocked in THIS review (their grants travel with the save; gone with the page). Never the visit store.
  const [pickerSession] = useState(createPickerUnlockSession);
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

  // 선택 안 함 is simply "no Collection chosen": the starting state, what choosing a Collection leaves, and what clearing them all
  // returns to - so a link can always be saved as it is.
  const noneChosen = selected.size === 0;
  // Functional updates: the picker may answer after a password prompt, when this render's closure is already old.
  const toggle = (collection: CollectionSummary) => {
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
    if (isSaving) {
      return;
    }
    clientRequestId.current ??= crypto.randomUUID();
    const collectionIds = [...selected];
    setIsSaving(true);
    setError(null);
    try {
      const saved = await api<SavedInboxEntry>({ method: 'POST', path: '/api/v1/inbox', body: saveInboxEntryBody(url, clientRequestId.current, collectionIds, unlockTokensFor(pickerSession, collectionIds)) });
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
      <PageHeader bell={false} title={dictionary.reviewTitle} />
      <ItemFormLayout onSubmit={() => void save()}>
        <ItemFormTop media={<ItemPhoto dictionary={dictionary} photoUrl={previewImageUrl} url={url} />}>
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
        </ItemFormTop>

        {/* Where it goes - full width under the link, a compact grid however many Collections there are; 선택 안 함 first. */}
        <ItemFormSections>
          <ItemCollectionsSection
            destinations={destinations}
            failed={destinationsFailed}
            noneSelected={noneChosen}
            onNone={() => setSelected(new Set())}
            onRefreshed={fresh => setDestinations(previous => (previous ? previous.map(entry => (entry.id === fresh.id ? fresh : entry)) : previous))}
            onToggle={toggle}
            onUnavailable={collectionId => {
              setDestinations(previous => (previous ? previous.filter(entry => entry.id !== collectionId) : previous));
              setSelected(previous => new Set([...previous].filter(id => id !== collectionId)));
            }}
            selectedIds={selected}
            session={pickerSession}
          />
          <ItemMemoSection onChange={setMemo} value={memo} />

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
            <ItemFormFooter>
              <button className={styles.primaryAction} disabled={isSaving} type="submit">
                {isSaving ? dictionary.saving : dictionary.save}
              </button>
            </ItemFormFooter>
          )}
        </ItemFormSections>
      </ItemFormLayout>
    </section>
  );
}
