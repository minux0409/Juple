import { useCallback, useRef, useState } from 'react';
import { removeItemReaction, setItemReaction } from '../collections/api/collectionsApi';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { toItemReactions, withMyReaction, type ItemReactions } from './reactionCatalog';

interface Override {
  /** The row the value was made for - a refreshed list brings new row objects, which drop it. */
  readonly source: object;
  readonly value: ItemReactions;
}

/**
 * The reactions of the links of ONE Collection on a screen: what the server sent with each link, with
 * the caller's own taps applied at once (optimistic) and settled by the server's answer.
 *
 * - react(item, key): the same reaction as the caller's own takes it back (DELETE), any other sets or
 *   changes it (PUT) - the server never toggles. The counts move immediately; a failure puts the
 *   previous state back and reports it.
 * - One mutation per link at a time: a tap on a link whose previous one is still on its way is
 *   ignored, so a fast double tap can never leave counts that were applied twice.
 * - A list that is loaded again replaces the rows, and with them every local value: the screen shows
 *   what the server says then.
 */
export function useItemReactions(
  authenticatedRequest: AuthenticatedApiRequest,
  collectionId: number,
  getUnlockToken: () => string | null,
  onFailure: () => void,
) {
  const [overrides, setOverrides] = useState<ReadonlyMap<number, Override>>(new Map());
  const inFlightRef = useRef(new Set<number>());
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  /** The reactions to draw for this row (a link row of the list, with its own server values). */
  const reactionsOf = useCallback(
    (itemId: number, row: { readonly reactions?: Parameters<typeof toItemReactions>[0]; readonly myReaction?: string | null }): ItemReactions => {
      const override = overrides.get(itemId);
      return override && override.source === row ? override.value : toItemReactions(row.reactions, row.myReaction);
    },
    [overrides],
  );

  const react = useCallback(
    async (itemId: number, row: { readonly reactions?: Parameters<typeof toItemReactions>[0]; readonly myReaction?: string | null }, key: string) => {
      if (inFlightRef.current.has(itemId)) {
        return;
      }
      const before = overrides.get(itemId)?.source === row ? (overrides.get(itemId) as Override).value : toItemReactions(row.reactions, row.myReaction);
      const next = before.myReaction === key ? null : key;
      inFlightRef.current.add(itemId);
      const put = (value: ItemReactions) => setOverrides(previous => new Map(previous).set(itemId, { source: row, value }));
      put(withMyReaction(before, next));
      try {
        const answer =
          next === null
            ? await removeItemReaction(authenticatedRequest, collectionId, itemId, getUnlockToken())
            : await setItemReaction(authenticatedRequest, collectionId, itemId, next, getUnlockToken());
        put(toItemReactions(answer.reactions, answer.myReaction));
      } catch {
        put(before);
        failureRef.current();
      } finally {
        inFlightRef.current.delete(itemId);
      }
    },
    [authenticatedRequest, collectionId, getUnlockToken, overrides],
  );

  return { reactionsOf, react } as const;
}
