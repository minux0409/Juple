import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';

type IconComponent = ComponentType<{ readonly color?: string; readonly size?: number }>;

/** One row of the compact 더보기 menu. */
export interface SelectionMenuRow {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconComponent;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

/** One button of the bottom action bar. A button with `menu` opens that compact menu instead of running `onPress`. */
export interface SelectionBarAction {
  readonly key: string;
  readonly label: string;
  readonly icon: IconComponent;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** An action is running: the whole bar ignores presses (no duplicate runs). */
  readonly busy?: boolean;
  readonly onPress?: () => void;
  readonly menu?: readonly SelectionMenuRow[];
}

export interface SelectionBarModel {
  readonly actions: readonly SelectionBarAction[];
}

interface SelectionBarContextValue {
  readonly bar: SelectionBarModel | null;
  readonly setBar: (owner: symbol, model: SelectionBarModel | null) => void;
}

const SelectionBarContext = createContext<SelectionBarContextValue>({ bar: null, setBar: () => undefined });

/**
 * Holds the bottom action bar of whichever screen is selecting. The bar takes the place of the tab bar (MainTabs renders it instead
 * of the tab bar while a model is set) - one slot, one owner at a time, cleared when the owner stops selecting or unmounts.
 */
export function SelectionBarProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<{ readonly owner: symbol; readonly model: SelectionBarModel } | null>(null);
  const setBar = useCallback((owner: symbol, model: SelectionBarModel | null) => {
    setState(previous => {
      if (model === null) {
        // Only the current owner may clear (a screen that lost focus never removes another screen's bar).
        return previous !== null && previous.owner === owner ? null : previous;
      }
      return { owner, model };
    });
  }, []);
  const value = useMemo<SelectionBarContextValue>(() => ({ bar: state?.model ?? null, setBar }), [setBar, state]);
  return <SelectionBarContext.Provider value={value}>{children}</SelectionBarContext.Provider>;
}

export function useSelectionBarModel(): SelectionBarModel | null {
  return useContext(SelectionBarContext).bar;
}

/** Everything that changes what the bar DRAWS - callbacks are not part of it (they are read from the latest render when pressed). */
export function selectionBarSignature(model: SelectionBarModel | null): string {
  if (model === null) {
    return '';
  }
  return model.actions
    .map(action => [
      action.key,
      action.label,
      action.destructive ? 'd' : '',
      action.disabled ? 'x' : '',
      action.busy ? 'b' : '',
      (action.menu ?? []).map(row => `${row.key}:${row.label}:${row.destructive ? 'd' : ''}:${row.disabled ? 'x' : ''}`).join(','),
    ].join('|'))
    .join(';');
}

/**
 * Shows `model` as the bottom bar while it is non-null (selection mode); null removes it. The bar is re-published only when what it
 * draws changes; the buttons call the CURRENT render's handlers, so a handler never closes over stale state.
 */
export function useSelectionBar(model: SelectionBarModel | null): void {
  const { setBar } = useContext(SelectionBarContext);
  const owner = useRef(Symbol('selection-bar')).current;
  const latest = useRef(model);
  latest.current = model;
  const signature = selectionBarSignature(model);
  const isShown = model !== null;

  useEffect(() => {
    if (!isShown || latest.current === null) {
      setBar(owner, null);
      return undefined;
    }
    const wrap = (action: SelectionBarAction): SelectionBarAction => ({
      ...action,
      onPress: () => latest.current?.actions.find(candidate => candidate.key === action.key)?.onPress?.(),
      menu: action.menu?.map(row => ({
        ...row,
        onPress: () => latest.current?.actions.find(candidate => candidate.key === action.key)?.menu?.find(candidateRow => candidateRow.key === row.key)?.onPress(),
      })),
    });
    setBar(owner, { actions: latest.current.actions.map(wrap) });
    return undefined;
    // `signature` stands for the drawn content; the handlers are read through `latest`.
  }, [isShown, owner, setBar, signature]);

  useEffect(() => () => setBar(owner, null), [owner, setBar]);
}
