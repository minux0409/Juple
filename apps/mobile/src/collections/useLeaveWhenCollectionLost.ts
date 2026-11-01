import { useEffect, useRef } from 'react';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { subscribeBlockChanges } from '../safety/useBlockedUsers';
import { getCollection } from './api/collectionsApi';

/**
 * Blocking the OWNER of a Collection ends my membership in it on the server (in the same transaction as the block). A Collection screen that
 * is open when that happens must not stay: right after the server accepted a block this asks the server whether I can still open THIS
 * Collection, and when it answers "not found" the screen calls `leave` (to the main tabs, whose Collections list reloads on focus). The server
 * decides; nothing here guesses who owns what. A failed or unclear answer leaves the screen as it is - its own writes are refused by the
 * server anyway.
 */
export function useLeaveWhenCollectionLost(collectionId: number, leave: () => void): void {
  const request = useAuthenticatedApi();
  // The subscription only needs the latest request function at call time.
  const requestRef = useRef(request);
  requestRef.current = request;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(
    () => subscribeBlockChanges((_jupleId, blocked) => {
      if (!blocked) {
        return;
      }
      getCollection(requestRef.current, collectionId).catch(caught => {
        if (caught instanceof ApiError && caught.kind === 'notFound') {
          leaveRef.current();
        }
      });
    }),
    [collectionId],
  );
}
