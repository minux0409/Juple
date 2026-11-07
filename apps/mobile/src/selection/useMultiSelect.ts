import { useCallback, useMemo, useState } from 'react';

/**
 * One screen's multi-selection ("long-press -> selection mode"). `null` is "not selecting"; a (possibly empty) set is selecting.
 * The state is per screen and per hook instance - nothing is shared between Home, Archive, the Collections list and a Collection,
 * so a stale selection can never follow the person to another screen.
 */
export interface MultiSelect<Id extends number | string> {
  /** Selection mode is on (even when nothing is chosen yet, as in a gallery). */
  readonly isActive: boolean;
  readonly selectedIds: ReadonlySet<Id>;
  readonly count: number;
  readonly isSelected: (id: Id) => boolean;
  /** Enters selection mode with nothing chosen yet (a menu entry that starts selecting). */
  readonly begin: () => void;
  /** Long-press: enters selection mode with this item already chosen (an item already chosen stays chosen). */
  readonly enter: (id: Id) => void;
  /** Short tap while selecting. */
  readonly toggle: (id: Id) => void;
  /** 전체 선택. */
  readonly selectAll: (ids: readonly Id[]) => void;
  /** 전체 해제: nothing chosen, so selection mode ends. */
  readonly clear: () => void;
  /** Leaves selection mode. */
  readonly exit: () => void;
  /**
   * Drops chosen ids that are no longer valid (a deleted / moved / refreshed-away item); when none is left, selection mode ends.
   * While the list is loading (`isLoading`) nothing is dropped: a list that is only temporarily empty must not end the selection.
   */
  readonly prune: (validIds: ReadonlySet<Id>, options?: { readonly isLoading?: boolean }) => void;
  /** Keeps exactly these ids chosen (after a partial failure: the failed ones stay selected for a retry); an empty list ends selection. */
  readonly replace: (ids: readonly Id[]) => void;
}

export function useMultiSelect<Id extends number | string>(): MultiSelect<Id> {
  const [selected, setSelected] = useState<ReadonlySet<Id> | null>(null);

  const begin = useCallback(() => setSelected(previous => previous ?? new Set<Id>()), []);
  const enter = useCallback((id: Id) => {
    setSelected(previous => {
      const next = new Set(previous ?? []);
      next.add(id);
      return next;
    });
  }, []);
  const toggle = useCallback((id: Id) => {
    setSelected(previous => {
      if (previous === null) {
        return previous;
      }
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // Un-choosing the last one ends selection.
      return next.size === 0 ? null : next;
    });
  }, []);
  const selectAll = useCallback((ids: readonly Id[]) => {
    setSelected(previous => (previous === null ? previous : new Set(ids)));
  }, []);
  const clear = useCallback(() => {
    setSelected(null);
  }, []);
  const exit = useCallback(() => setSelected(null), []);
  const prune = useCallback((validIds: ReadonlySet<Id>, options?: { readonly isLoading?: boolean }) => {
    if (options?.isLoading === true) {
      return;
    }
    setSelected(previous => {
      // Nothing chosen yet (an empty selection started from a menu) has nothing to drop.
      if (previous === null || previous.size === 0) {
        return previous;
      }
      let changed = false;
      const next = new Set<Id>();
      previous.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      if (!changed) {
        return previous;
      }
      return next.size === 0 ? null : next;
    });
  }, []);
  const replace = useCallback((ids: readonly Id[]) => {
    setSelected(previous => (previous === null ? previous : ids.length === 0 ? null : new Set(ids)));
  }, []);

  const emptySet = useMemo<ReadonlySet<Id>>(() => new Set<Id>(), []);
  const selectedIds = selected ?? emptySet;
  const isSelected = useCallback((id: Id) => selected?.has(id) === true, [selected]);

  return useMemo(
    () => ({ isActive: selected !== null, selectedIds, count: selectedIds.size, isSelected, begin, enter, toggle, selectAll, clear, exit, prune, replace }),
    [begin, clear, enter, exit, isSelected, prune, replace, selectAll, selected, selectedIds, toggle],
  );
}
