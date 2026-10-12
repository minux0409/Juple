'use client';

import { useRouter } from 'next/navigation';
import { useSignedInApp } from '../../AppRoot';
import { BackButton } from '../../PageStates';
import { BackRow } from '../../PageHeader';
import { ItemDetailContent } from './ItemDetailContent';
import styles from '../../app.module.css';

/**
 * The standalone page of a link (/items/{id} typed, reloaded or opened from outside the app): a compact, centred column around the
 * same ItemDetailContent the Quick Detail sheet shows. Inside the app a click opens the sheet over the current page instead
 * (app/(app)/@modal/(.)items/[itemId]) - same address, different presentation.
 */
export function ItemDetailsView({
  itemIdParam,
  lockedBy,
  fromCollectionId,
}: {
  readonly itemIdParam: string;
  readonly lockedBy: number | null;
  readonly fromCollectionId: number | null;
}) {
  const { dictionary } = useSignedInApp();
  const router = useRouter();

  const leave = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.replace('/archive');
    }
  };

  return (
    <section className={`${styles.page} ${styles.quickPage}`}>
      <BackRow>
        <BackButton dictionary={dictionary} fallbackHref="/" />
      </BackRow>
      <div className={styles.quickPageCard}>
        <ItemDetailContent fromCollectionId={fromCollectionId} itemIdParam={itemIdParam} lockedBy={lockedBy} onLeave={leave} />
      </div>
    </section>
  );
}
