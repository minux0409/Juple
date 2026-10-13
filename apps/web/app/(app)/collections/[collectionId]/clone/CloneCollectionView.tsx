'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../../lib/authSession';
import { collectionPath, isNotFound, type CollectionDetail } from '../../../../../lib/collectionDetails';
import { createCollection } from '../../../../../lib/collectionEditor';
import { collectionContentGate } from '../../../../../lib/collectionGate';
import { cloneCollection, cloneInitialDraft, rememberCloneResult } from '../../../../../lib/collectionOperations';
import { isSharedWithMe } from '../../../../../lib/collectionSharing';
import { unlockHeaders, unlockTokenFor } from '../../../../../lib/collectionUnlock';
import { collectionHref, parseRouteId } from '../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../AppRoot';
import { BackButton, LoadFailed, Notice } from '../../../PageStates';
import { PageHeader } from '../../../PageHeader';
import { CollectionHeaderSkeleton } from '../../../Skeletons';
import { CollectionEditor } from '../../CollectionEditor';
import { UnlockPanel } from '../UnlockPanel';
import styles from '../../../app.module.css';

type State = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly collection: CollectionDetail };

/**
 * 내 컬렉션으로 복제 - the SAME editor page as 새 컬렉션 / 수정 (CollectionEditor in clone mode), started from a Collection shared with me:
 * its name, glyph and colour (never its photo - see cloneInitialDraft), all editable, then 복제 creates a new Collection of MINE with
 * them (photo included when one is chosen here) and copies every link I can see there into it (lib/collectionOperations
 * .cloneCollection: chunks of 200, a partial copy said as such). People, invitations, password, sharing, comments, replies, hearts and
 * reactions are never copied, and the source is never changed. The new Collection opens and says how the copy went.
 *
 * Only for a member (the Owner has 병합 instead); a share-password-protected source asks its password first - the copy reads it.
 */
export function CloneCollectionView({ collectionIdParam }: { readonly collectionIdParam: string }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const collectionId = parseRouteId(collectionIdParam);
  const [state, setState] = useState<State>(collectionId === null ? { kind: 'notFound' } : { kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (collectionId === null) {
      return undefined;
    }
    let ignore = false;
    api<CollectionDetail>({ path: collectionPath(collectionId) }).then(
      collection => {
        if (!ignore) {
          setState({ kind: 'loaded', collection });
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
        setState(isNotFound(caught) ? { kind: 'notFound' } : { kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId, onSessionLost, reloadToken]);

  const back = <BackButton dictionary={dictionary} fallbackHref={collectionId === null ? '/collections' : collectionHref(collectionId)} />;

  if (state.kind !== 'loaded') {
    return (
      <section className={styles.page}>
        {back}
        {state.kind === 'loading' ? <CollectionHeaderSkeleton /> : null}
        {state.kind === 'notFound' ? <Notice message={dictionary.collectionNotFound} /> : null}
        {state.kind === 'failed' ? (
          <LoadFailed
            dictionary={dictionary}
            onRetry={() => {
              setState({ kind: 'loading' });
              setReloadToken(token => token + 1);
            }}
          />
        ) : null}
      </section>
    );
  }

  const { collection } = state;
  if (!isSharedWithMe(collection)) {
    return (
      <section className={styles.page}>
        {back}
        <Notice message={dictionary.collectionNotFound} />
      </section>
    );
  }
  const gate = collectionContentGate(collection);
  if (gate && unlockTokenFor(collection.id) === null) {
    return (
      <section className={styles.page}>
        {back}
        <UnlockPanel
          collectionId={collection.id}
          isOwner={false}
          kind={gate}
          onStateChanged={() => {
            setState({ kind: 'loading' });
            setReloadToken(token => token + 1);
          }}
          onUnlocked={() => setReloadToken(token => token + 1)}
        />
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {back}
      <PageHeader bell={false} title={dictionary.cloneToMine} />
      <p className={styles.pageSubtitle}>{dictionary.cloneHint}</p>
      <CollectionEditor
        collectionId={collection.id}
        dictionary={dictionary}
        error={error}
        initial={cloneInitialDraft(collection)}
        initialImageUrl={null}
        isSubmitting={isSubmitting}
        mode="clone"
        onCancel={() => router.back()}
        onSubmit={draft => {
          setIsSubmitting(true);
          setError(null);
          cloneCollection(api, collection.id, () => createCollection(api, draft, dictionary), unlockHeaders(collection.id)).then(outcome => {
            if (outcome.kind === 'notCreated') {
              if (isSessionLost(outcome.error)) {
                onSessionLost();
                return;
              }
              setError(outcome.message);
              setIsSubmitting(false);
              return;
            }
            rememberCloneResult(outcome);
            router.replace(collectionHref(outcome.collectionId));
          });
        }}
      />
    </section>
  );
}
