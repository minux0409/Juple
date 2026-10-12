'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { createCollection, DEFAULT_COLLECTION_COLOR } from '../../../../lib/collectionEditor';
import { collectionHref } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { BackButton } from '../../PageStates';
import { CollectionEditor } from '../CollectionEditor';
import { PageHeader } from '../../PageHeader';
import styles from '../../app.module.css';

/**
 * 새 컬렉션 (mobile: the Collections screen's + button and CategoryEditorDialog in create mode) - a page, so back works. On success
 * the new Collection opens (the list behind it shows it on the next visit); a photo that could not be saved leaves the Collection with
 * its icon and says why.
 */
export default function NewCollectionPage() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className={styles.page}>
      <BackButton dictionary={dictionary} fallbackHref="/collections" />
      <PageHeader bell={false} title={dictionary.collectionCreate} />
      <CollectionEditor
        collectionId={0}
        dictionary={dictionary}
        error={error}
        initial={{ name: '', icon: 'Folder', color: DEFAULT_COLLECTION_COLOR }}
        initialImageUrl={null}
        isSubmitting={isSubmitting}
        mode="create"
        onCancel={() => router.back()}
        onSubmit={draft => {
          setIsSubmitting(true);
          setError(null);
          createCollection(api, draft, dictionary).then(outcome => {
            if (outcome.ok) {
              if (outcome.warning) {
                window.alert(outcome.warning);
              }
              router.replace(collectionHref(outcome.collection.id));
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
