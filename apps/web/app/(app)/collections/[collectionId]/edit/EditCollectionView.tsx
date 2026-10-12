'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../../lib/authSession';
import { collectionPath, isNotFound, type CollectionDetail } from '../../../../../lib/collectionDetails';
import { canEditCollection, effectiveCollectionColor, updateCollection } from '../../../../../lib/collectionEditor';
import { collectionIconImage, collectionIconKey, isCollectionLocked } from '../../../../../lib/collectionsView';
import { collectionHref, parseRouteId } from '../../../../../lib/savedLinks';
import { useSignedInApp } from '../../../AppRoot';
import { BackButton, LoadFailed, Notice } from '../../../PageStates';
import { CollectionHeaderSkeleton } from '../../../Skeletons';
import { CollectionEditor } from '../../CollectionEditor';
import { UnlockPanel } from '../UnlockPanel';
import { unlockHeaders, unlockTokenFor } from '../../../../../lib/collectionUnlock';
import { PageHeader } from '../../../PageHeader';
import styles from '../../../app.module.css';

type State = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly collection: CollectionDetail };

/**
 * 컬렉션 수정 (mobile: the Owner's 편집 in Collection Details) - the same editor, saving only what changed. A locked Collection is
 * edited only after its password, which the Web does not take yet - said plainly instead of a form that would be refused.
 */
export function EditCollectionView({ collectionIdParam }: { readonly collectionIdParam: string }) {
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
  if (!canEditCollection(collection)) {
    return (
      <section className={styles.page}>
        {back}
        <Notice message={dictionary.collectionNotFound} />
      </section>
    );
  }
  // A locked Collection is edited only with its grant (mobile runUnlocked): without one, its password first, here.
  if (isCollectionLocked(collection) && unlockTokenFor(collection.id) === null) {
    return (
      <section className={styles.page}>
        {back}
        <UnlockPanel
          collectionId={collection.id}
          isOwner
          kind="lock"
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
      <PageHeader bell={false} title={dictionary.collectionEditTitle} />
      <CollectionEditor
        collectionId={collection.id}
        dictionary={dictionary}
        error={error}
        initial={{ name: collection.name, icon: collectionIconKey(collection.icon), color: effectiveCollectionColor(collection.color, collection.id) }}
        initialImageUrl={collectionIconImage(collection)}
        isSubmitting={isSubmitting}
        mode="edit"
        onCancel={() => router.back()}
        onSubmit={draft => {
          setIsSubmitting(true);
          setError(null);
          updateCollection(api, collection, draft, dictionary, unlockHeaders(collection.id)).then(outcome => {
            if (outcome.ok) {
              router.replace(collectionHref(collection.id));
              return;
            }
            if (isSessionLost(outcome.error)) {
              onSessionLost();
              return;
            }
            setError(outcome.message);
            setIsSubmitting(false);
          });
        }}
      />
    </section>
  );
}
