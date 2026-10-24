'use client';

import { useEffect, useState } from 'react';
import { isSharedWithMe } from '../../../../lib/collectionSharing';
import type { CollectionSummary } from '../../../../lib/collectionsView';
import { useSignedInApp } from '../../AppRoot';
import { UnlockPanel } from '../../collections/[collectionId]/UnlockPanel';
import styles from '../../app.module.css';

/**
 * The link was opened from a card its Collection locks: the password of THAT Collection stands before it (the Owner's lock, or a
 * member's access password). The grant is kept for this link's pages only (itemOpenGrant.ts) and never shared with a Collection
 * visit or the picker.
 */
export function GatedLink({
  collectionId,
  gate,
  onGranted,
  onStateChanged,
}: {
  readonly collectionId: number;
  readonly gate: 'lock' | 'sharePassword';
  readonly onGranted: (grant: { readonly unlockToken: string; readonly expiresAtUtc: string }) => void;
  readonly onStateChanged: () => void;
}) {
  const { api } = useSignedInApp();
  const [isOwner, setIsOwner] = useState(true);
  useEffect(() => {
    let ignore = false;
    api<CollectionSummary>({ path: `/api/v1/collections/${collectionId}` }).then(
      collection => {
        if (!ignore) {
          // A member's own personal lock opens with their own password: no "ask the owner" hint then.
          setIsOwner(!isSharedWithMe(collection) || (collection.isMemberLocked === true && gate === 'lock'));
        }
      },
      () => undefined,
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId, gate]);
  // Centered in the content area (both ways) of the sheet / page it stands in; the header and 닫기 keep their place.
  return (
    <div className={styles.gatedCenter}>
      <UnlockPanel collectionId={collectionId} isOwner={isOwner} kind={gate} onGranted={onGranted} onStateChanged={onStateChanged} onUnlocked={() => undefined} />
    </div>
  );
}
