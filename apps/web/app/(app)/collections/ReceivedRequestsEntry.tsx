'use client';

import { useState } from 'react';
import { formatMessage } from '../../../lib/appI18n';
import { ownerRequestCollections } from '../../../lib/collectionApprovals';
import { collectionTile } from '../../../lib/collectionsView';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph } from '../Glyph';
import { Modal } from '../Modal';
import { useAttention } from '../useAttention';
import { AttentionBadge } from '../AttentionBadge';
import { ReceivedRequestsDialog } from './ReceivedRequestsDialog';
import { RequestRow } from './RequestRow';
import styles from './ReceivedRequests.module.css';

/**
 * 받은 승인 요청 on 공유 컬렉션: the Collections where I am the Owner and something waits for my answer (proposed links, people asking to
 * join), from the same account store as every badge - so this row, the type badge and the menu number always agree. One Collection
 * answers directly; several are listed first. Shown only while something waits.
 */
export function ReceivedRequestsEntry({ onChanged }: { readonly onChanged: () => void }) {
  const { snapshot } = useAttention();
  const { dictionary } = useSignedInApp();
  const [picking, setPicking] = useState(false);
  // The Collection being answered: kept as picked, so its name stays in the title after its last request is answered.
  const [selected, setSelected] = useState<{ readonly id: number; readonly name: string } | null>(null);
  const owned = ownerRequestCollections(snapshot.collections);
  const total = snapshot.counts.requests.approvals;
  if (total === 0 && selected === null) return null;
  // One wrapper: the page's section gap applies to it once, however many dialogs (closed, out of flow) it holds.
  return (
    <div data-request-entry>
      {total > 0 ? (
        <RequestRow
          accessibleLabel={formatMessage(dictionary.requestsPendingSubmissionsA11y, { count: total })}
          count={total}
          expanded={picking}
          label={dictionary.requestsPendingSubmissions}
          onClick={() => (owned.length === 1 ? setSelected({ id: owned[0].id, name: owned[0].name }) : setPicking(true))}
          testId="received-approvals"
        />
      ) : null}
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
                  onClick={() => { setPicking(false); setSelected({ id: collection.id, name: collection.name }); }}
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
      {selected !== null ? (
        <ReceivedRequestsDialog
          collection={selected}
          onChanged={onChanged}
          onClose={() => setSelected(null)}
          open
        />
      ) : null}
    </div>
  );
}
