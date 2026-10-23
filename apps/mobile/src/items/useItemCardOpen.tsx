import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollection } from '../collections/api/collectionsApi';
import { contentGateOf, isSharedWithMe, type CollectionContentGate } from '../collections/collectionAccess';
import { CollectionUnlockModal } from '../collections/CollectionUnlockModal';
import { contentGateOfError } from '../collections/useCollectionItems';
import { getItemDetails, type ItemHistoryEntry } from './api/itemsApi';
import { handOffItemOpenGrant, type ItemOpenContext } from './itemOpenGrant';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ApiError } from '../api/ApiError';
import { browseFailureMessage } from './browseFailureMessage';

interface PendingOpen {
  readonly itemId: number;
  readonly collectionId: number;
  readonly gate: CollectionContentGate;
  readonly isOwner: boolean;
}

/**
 * Opens a Home/Archive card whose link belongs to a Collection - always IN that Collection's context, so the server
 * enforces its lock (GET items/{id}?collectionId=): the Collection's CURRENT access is read first (never the list's
 * copy), so a lock switched on or off elsewhere is honored either way. While it is locked, EVERY open asks for the
 * password: the grant the correct password returns belongs to that one opening only - it is handed to the Item Details
 * popup it opens (itemOpenGrant, in memory, taken once) and is gone when the popup closes, so the next tap asks again.
 * It is never stored in collectionUnlockGrants or anywhere else, and a Collection Details visit's grant is never
 * borrowed either.
 */
export function useItemCardOpen(onNavigate: (itemId: number, openContext?: ItemOpenContext) => void, onRefresh: () => void) {
  const request = useAuthenticatedApi();
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingOpen | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The grant of the opening in progress (from the password panel) - only until that opening is finished.
  const openingGrantRef = useRef<string | null>(null);
  const openInFlight = useRef(false);

  const promptFor = useCallback(async (itemId: number, collectionId: number) => {
    const fresh = await getCollection(request, collectionId);
    const gate = contentGateOf(fresh);
    if (!gate) {
      return false;
    }
    setPending({ itemId, collectionId, gate, isOwner: !isSharedWithMe(fresh) });
    return true;
  }, [request]);

  const finishOpen = useCallback(async (itemId: number, collectionId: number | null, unlockToken: string | null) => {
    try {
      if (collectionId === null) {
        onNavigate(itemId);
        return;
      }
      // The server's own check, in the card's Collection context with THIS opening's grant (or none, when the
      // Collection is not locked now) - never the context-free read.
      await getItemDetails(request, itemId, { collectionId, unlockToken });
      onNavigate(itemId, { collectionId, grantKey: unlockToken ? handOffItemOpenGrant(collectionId, unlockToken) : null });
    } catch (caughtError) {
      // Locked again (or the grant is no longer valid) since the state was read: ask again, never open anything.
      if (collectionId !== null && contentGateOfError(caughtError) !== null) {
        try {
          if (await promptFor(itemId, collectionId)) {
            return;
          }
        } catch {
          // Falls through to the plain failure below.
        }
      }
      Keyboard.dismiss();
      if (caughtError instanceof ApiError && (caughtError.status === 403 || caughtError.status === 404)) onRefresh();
      setError(browseFailureMessage(caughtError, t) ?? t('collections.errorItemsLoadFallback'));
    } finally {
      openingGrantRef.current = null;
    }
  }, [onNavigate, onRefresh, promptFor, request, t]);

  const open = useCallback(async (item: Pick<ItemHistoryEntry, 'id' | 'collectionId'>) => {
    if (openInFlight.current || pending) return;
    openInFlight.current = true;
    openingGrantRef.current = null;
    if (!item.collectionId) {
      onNavigate(item.id);
      openInFlight.current = false;
      return;
    }
    try {
      if (await promptFor(item.id, item.collectionId)) {
        return;
      }
      await finishOpen(item.id, item.collectionId, null);
    } catch (caughtError) {
      Keyboard.dismiss();
      setError(browseFailureMessage(caughtError, t) ?? t('collections.errorItemsLoadFallback'));
    } finally {
      openInFlight.current = false;
    }
  }, [finishOpen, onNavigate, pending, promptFor, t]);

  const onStateChanged = useCallback(async () => {
    if (!pending) { return true; }
    try {
      const fresh = await getCollection(request, pending.collectionId);
      if (contentGateOf(fresh)) { return false; }
      const { itemId, collectionId } = pending;
      setPending(null);
      await finishOpen(itemId, collectionId, null);
      return true;
    } catch { return false; }
  }, [finishOpen, pending, request]);

  const cancel = () => {
    openingGrantRef.current = null;
    setPending(null);
  };

  const dialog = <>
    {pending ? (
      <CollectionUnlockModal
        collectionId={pending.collectionId}
        isOwner={pending.isOwner}
        kind={pending.gate}
        onCancel={cancel}
        // Single-use: the grant is kept only for this opening (the panel stores nothing when given onGranted).
        onGranted={unlockToken => {
          openingGrantRef.current = unlockToken;
        }}
        onStateChanged={onStateChanged}
        onUnlocked={() => {
          const { itemId, collectionId } = pending;
          const unlockToken = openingGrantRef.current;
          setPending(null);
          finishOpen(itemId, collectionId, unlockToken).catch(() => undefined);
        }}
        visible
      />
    ) : null}
    {error ? <ConfirmDialog confirmLabel={t('common.confirm')} message={error} onConfirm={() => setError(null)} title={t('common.notice')} visible /> : null}
  </>;
  return { open, dialog };
}
