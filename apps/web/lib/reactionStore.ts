import type { ItemReactions } from './itemCollaboration.ts';

/**
 * The reactions of each link IN each Collection, shared by everything that shows them in this tab - a Collection's link card and the
 * link's detail sheet over it - so a tap in one is seen in the other at once, and a list reload / a freshly read link seeds the newer
 * server truth. In memory only (nothing persisted); cleared when the signed-in account ends.
 */
const states = new Map<string, ItemReactions>();
const listeners = new Set<() => void>();

export const reactionKey = (collectionId: number, itemId: number) => `${collectionId}/${itemId}`;

const same = (a: ItemReactions | undefined, b: ItemReactions) => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

export function publishReactions(key: string, state: ItemReactions): void {
  if (same(states.get(key), state)) {
    return;
  }
  states.set(key, state);
  for (const listener of [...listeners]) {
    listener();
  }
}

export function readReactions(key: string): ItemReactions | undefined {
  return states.get(key);
}

export function subscribeReactions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearReactionStore(): void {
  states.clear();
  for (const listener of [...listeners]) {
    listener();
  }
}
