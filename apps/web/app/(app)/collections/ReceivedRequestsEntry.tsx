'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatMessage } from '../../../lib/appI18n';
import { ownerRequestCollections, REQUESTS_PARAM } from '../../../lib/collectionApprovals';
import { collectionHref } from '../../../lib/savedLinks';
import { collectionTile } from '../../../lib/collectionsView';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph } from '../Glyph';
import { Modal } from '../Modal';
import { useAttention } from '../useAttention';
import { AttentionBadge } from '../AttentionBadge';
import { RequestRow } from './RequestRow';
import styles from './ReceivedRequests.module.css';

/**
 * 받은 승인 요청 on 공유 컬렉션 - the mobile flow, step for step: the row opens the list of MY Collections that hold waiting requests (name,
 * picture, how many), and choosing one goes to that Collection's own page, where its requests open (`?requests=1`, the same address a
 * notification uses - one history entry, so Back returns to this list). Every number comes from the account store the badges use. The row
 * exists only while something waits.
 */
export function ReceivedRequestsEntry() {
  const router = useRouter();
  const { snapshot } = useAttention();
  const { dictionary } = useSignedInApp();
  const [picking, setPicking] = useState(false);
  const owned = ownerRequestCollections(snapshot.collections);
  const total = snapshot.counts.requests.approvals;
  if (total === 0) return null;
  return (
    <div data-request-entry>
      <RequestRow
        accessibleLabel={formatMessage(dictionary.requestsPendingSubmissionsA11y, { count: total })}
        count={total}
        expanded={picking}
        label={dictionary.requestsPendingSubmissions}
        onClick={() => setPicking(true)}
        testId="received-approvals"
      />
      <Modal closeLabel={dictionary.close} onClose={() => setPicking(false)} open={picking} title={dictionary.requestsPendingSubmissions}>
        <ul className={styles.list}>
          {owned.map(collection => {
            const tile = collectionTile(collection.color, collection.id);
            return (
              <li key={collection.id}>
                <button
                  aria-label={`${collection.name}, ${formatMessage(dictionary.requestsPendingSubmissionsA11y, { count: collection.requestCount })}`}
                  className={styles.pick}
                  data-request-collection={collection.id}
                  onClick={() => {
                    setPicking(false);
                    router.push(`${collectionHref(collection.id)}?${REQUESTS_PARAM}=1`);
                  }}
                  type="button"
                >
                  <span aria-hidden className={styles.tile} style={{ background: tile.background, color: tile.icon }}><CollectionGlyph icon={collection.icon} size={20} /></span>
                  <span className={styles.pickName} dir="auto">{collection.name}</span>
                  <AttentionBadge count={collection.requestCount} />
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    </div>
  );
}
