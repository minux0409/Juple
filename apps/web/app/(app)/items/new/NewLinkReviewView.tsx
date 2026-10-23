'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ApiHttpError } from '../../../../lib/appApi';
import { isSessionLost } from '../../../../lib/authSession';
import { loadDestinations } from '../../../../lib/collectionDestinations';
import { classifyCollectionShareUrl, collectionShareDestination, refusedShareUrlDestination, type CollectionShareDestination } from '../../../../lib/collectionShareUrl';
import type { CollectionSummary } from '../../../../lib/collectionsView';
import {
  COLLECTION_SHARE_URL_NOT_SAVABLE_CODE,
  isHttpUrl,
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
import { SaveOutcomeDialog } from '../../SaveOutcomeDialog';
import { PageHeader } from '../../PageHeader';
import styles from '../../app.module.css';

/**
 * 새 링크 검토 - the mobile NewLinkReviewScreen for a link typed on Home: the link (exactly what will be saved), the title the server
 * found (or the person's own; never guessed), where it goes (any number of Collections, or explicitly 선택 안 함 - Save waits for that
 * decision), a memo, and the preview image the server found. Save creates the link once; a retry of the same link replays it.
 */
export function NewLinkReviewView({ url }: { readonly url: string }) {
  const { api, dictionary, onSessionLost, publicWebHost } = useSignedInApp();
  const router = useRouter();
  const valid = isHttpUrl(url);
  // A Juple Collection share link (of ANY Juple environment) is never reviewed or saved as a link (the mobile NewLinkReview): it goes to
  // the Collection flow at once - this environment's /shared, or the other environment's own address. Nothing is resolved or offered;
  // neither destination ever comes back here, so this cannot loop.
  const shareLink = classifyCollectionShareUrl(url, publicWebHost);
  const shareTarget = shareLink ? collectionShareDestination(shareLink) : null;
  const shareTargetKind = shareTarget?.kind ?? null;
  const shareTargetAddress = shareTarget ? (shareTarget.kind === 'inApp' ? shareTarget.href : shareTarget.url) : null;
  /** Leaves for a Collection share link's destination, replacing this page in the history (Back never returns to a review of it). */
  const leaveFor = (destination: CollectionShareDestination) => {
    if (destination.kind === 'inApp') {
      router.replace(destination.href);
    } else {
      window.location.replace(destination.url);
    }
  };
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
    if (shareTargetKind === 'inApp' && shareTargetAddress) {
      router.replace(shareTargetAddress);
    } else if (shareTargetKind === 'otherEnvironment' && shareTargetAddress) {
      window.location.replace(shareTargetAddress);
    }
  }, [router, shareTargetAddress, shareTargetKind]);

  useEffect(() => {
    if (!valid || shareTargetKind) {
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
  }, [api, onSessionLost, shareTargetKind, url, valid]);

  const back = <BackButton dictionary={dictionary} fallbackHref="/" />;
  if (shareTargetKind) {
    return null;
  }
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
        const destination = refusedShareUrlDestination(url, publicWebHost);
        if (destination) {
          leaveFor(destination);
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
            onCreated={created => {
              // The new Collection is in the list at once and chosen; what was chosen before stays chosen.
              setDestinations(previous => [created, ...(previous ?? []).filter(entry => entry.id !== created.id)]);
              setSelected(previous => new Set(previous).add(created.id));
            }}
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
          {outcome ? null : (
            <ItemFormFooter>
              <button className={styles.primaryAction} disabled={isSaving} type="submit">
                {isSaving ? dictionary.saving : dictionary.save}
              </button>
            </ItemFormFooter>
          )}
        </ItemFormSections>
      </ItemFormLayout>
      <SaveOutcomeDialog confirmLabel={dictionary.confirm} message={outcome} onConfirm={() => router.replace('/')} />
    </section>
  );
}
