'use client';

import { useEffect, useState } from 'react';
import { isSharedWithMe } from '../../../../lib/collectionSharing';
import type { CollectionSummary } from '../../../../lib/collectionsView';
import { useSignedInApp } from '../../AppRoot';
import { UnlockPanel } from '../../collections/[collectionId]/UnlockPanel';

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
          setIsOwner(!isSharedWithMe(collection));
        }
      },
      () => undefined,
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId]);
  return <UnlockPanel collectionId={collectionId} isOwner={isOwner} kind={gate} onGranted={onGranted} onStateChanged={onStateChanged} onUnlocked={() => undefined} />;
}
