/**
 * The pure rules of multi-selection on the Web (mobile selection/useMultiSelect): which ids are chosen, the anchor a Shift+click
 * extends from, and the few set operations the pages need. No React here, so the rules are unit-tested.
 *
 * Starting a selection is always explicit (a card's check, or the toolbar) - a plain click on a card keeps opening it, and a
 * Ctrl/Cmd+click keeps the browser's "open in a new tab" until a selection is running. While one runs:
 *  - a click (or Ctrl/Cmd+click) toggles that card;
 *  - Shift+click selects every card between the anchor and that card, in the order the list shows them (the anchor stays);
 *  - the toolbar's close, Escape, or the last card un-chosen ends it.
 */

export interface MultiSelectState<T> {
  readonly selected: ReadonlySet<T>;
  /** The card a Shift+click extends from: the last one toggled on purpose. */
  readonly anchor: T | null;
}

export function emptySelection<T>(): MultiSelectState<T> {
  return { selected: new Set<T>(), anchor: null };
}

export function toggleSelection<T>(state: MultiSelectState<T>, id: T): MultiSelectState<T> {
  const selected = new Set(state.selected);
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  return { selected, anchor: id };
}

/**
 * Shift+click: everything from the anchor to `id` in `order` is chosen (added to what is already chosen - never a loss). Without an
 * anchor in this list (nothing toggled yet, or it was in another list) it is a plain toggle.
 */
export function selectRange<T>(state: MultiSelectState<T>, order: readonly T[], id: T): MultiSelectState<T> {
  const from = state.anchor === null ? -1 : order.indexOf(state.anchor);
  const to = order.indexOf(id);
  if (from < 0 || to < 0) {
    return toggleSelection(state, id);
  }
  const [start, end] = from <= to ? [from, to] : [to, from];
  const selected = new Set(state.selected);
  for (let index = start; index <= end; index += 1) {
    selected.add(order[index]);
  }
  return { selected, anchor: state.anchor };
}

export function selectAll<T>(state: MultiSelectState<T>, ids: readonly T[]): MultiSelectState<T> {
  return { selected: new Set([...state.selected, ...ids]), anchor: state.anchor };
}

/** Drops ids that are gone (deleted, filtered away by a refresh). The same object comes back when nothing changed. */
export function pruneSelection<T>(state: MultiSelectState<T>, keep: (id: T) => boolean): MultiSelectState<T> {
  const selected = [...state.selected].filter(keep);
  if (selected.length === state.selected.size) {
    return state;
  }
  return { selected: new Set(selected), anchor: state.anchor !== null && keep(state.anchor) ? state.anchor : null };
}

/** Removes exactly these ids (they were handled); the failed ones stay chosen for a retry. */
export function withoutIds<T>(state: MultiSelectState<T>, ids: Iterable<T>): MultiSelectState<T> {
  const gone = new Set(ids);
  return pruneSelection(state, id => !gone.has(id));
}

/** What the click on a selectable card means, from its modifier keys and whether a selection is running. */
export type CardClickIntent = 'open' | 'toggle' | 'range';

export function cardClickIntent(active: boolean, keys: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean }): CardClickIntent {
  if (!active) {
    return 'open';
  }
  return keys.shiftKey ? 'range' : 'toggle';
}

/**
 * Runs `task` over `ids` a few at a time (mobile selection/runBatch): every id is its own request, a failure never stops the others.
 * Resolves with which ids succeeded and which failed (with the first error for the message).
 */
export async function runBatch<T>(ids: readonly T[], task: (id: T) => Promise<void>, concurrency = 4): Promise<{ readonly succeeded: readonly T[]; readonly failed: readonly T[]; readonly firstError: unknown }> {
  const succeeded: T[] = [];
  const failed: T[] = [];
  let firstError: unknown = null;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next];
      next += 1;
      try {
        await task(id);
        succeeded.push(id);
      } catch (error) {
        if (failed.length === 0) {
          firstError = error;
        }
        failed.push(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, worker));
  // Keep the caller's order (the workers finish in any order).
  const rank = new Map(ids.map((id, index) => [id, index]));
  succeeded.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  failed.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return { succeeded, failed, firstError };
}

/** Several links copied / shared as one text: one address per line (mobile formatLinkList). */
export function formatLinkList(urls: readonly (string | null | undefined)[]): string {
  return urls.filter((url): url is string => typeof url === 'string' && url.length > 0).join('\n');
}
