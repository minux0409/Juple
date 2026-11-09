'use client';

import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { formatMessage, type AppDictionary } from '../../lib/appI18n';
import { Glyph } from './Glyph';
import styles from './app.module.css';

export interface SelectionAction {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentProps<typeof Glyph>['name'];
  readonly onClick: () => void;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
}

/**
 * The bar of a running selection (mobile SelectionTopBar + the bottom action bar, one bar on the Web): how many are chosen, the actions
 * for them, 전체 선택 when the page offers it, and 선택 종료. It is docked to the bottom of the BROWSER window (position: fixed),
 * centred on the content column beside the side bar - collapsing / expanding the side bar re-centres it (the column is measured) - and
 * never moves with scrolling. It is rendered through a portal into the app shell: no page ancestor (the page entrance transform,
 * overflow, contain) can become its containing block, while the shell keeps the colour tokens. Its own height is added as bottom room of
 * the content column keeps the last link reachable; it rises in with a short slide and leaves the same way.
 *
 * The bar itself never deletes anything: a destructive action only opens its confirmation.
 */
export function SelectionToolbar({
  count,
  actions,
  dictionary,
  onExit,
  onSelectAll,
  busy = false,
}: {
  readonly count: number;
  readonly actions: readonly SelectionAction[];
  readonly dictionary: AppDictionary;
  readonly onExit: () => void;
  readonly onSelectAll?: () => void;
  readonly busy?: boolean;
}) {
  // The bar exists only after the person starts a selection (client side), so the shell can be looked up right away.
  const [target] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : (document.querySelector<HTMLElement>('[data-app-shell]') ?? document.body)));
  const [span, setSpan] = useState({ left: 0, right: 0 });
  const barRef = useRef<HTMLDivElement | null>(null);

  // The content column (the shell's <main>): the dock spans exactly it, so the bar is centred on the content and follows the side bar.
  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-app-shell]');
    const main = shell?.querySelector<HTMLElement>('main') ?? null;
    if (!main) {
      return undefined;
    }
    const measure = () => {
      const rect = main.getBoundingClientRect();
      setSpan({ left: Math.max(0, Math.round(rect.left)), right: Math.max(0, Math.round(document.documentElement.clientWidth - rect.right)) });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // The bar's own height becomes extra room at the end of the content column (--selection-room on the shell, read by .content), so the
  // last link and button can always be scrolled clear of it, wherever on the page the selection lives. It leaves with the bar.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !target) {
      return undefined;
    }
    const measure = () => target.style.setProperty('--selection-room', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      target.style.removeProperty('--selection-room');
    };
  }, [target]);

  const bar = (
    <div className={styles.selectionBarDock} data-selection-dock style={{ '--dock-left': `${span.left}px`, '--dock-right': `${span.right}px` } as React.CSSProperties}>
    <div aria-label={dictionary.selectionSelectItems} className={styles.selectionBar} data-selection-bar ref={barRef} role="toolbar">
      <button aria-label={dictionary.selectionExit} className={styles.selectionBarIcon} onClick={onExit} title={dictionary.selectionExit} type="button">
        <Glyph name="Close" size={18} />
      </button>
      <span aria-live="polite" className={styles.selectionBarCount} data-selection-count>
        {count > 0 ? formatMessage(dictionary.selectionSelectedCount, { count }) : dictionary.selectionSelectItems}
      </span>
      {onSelectAll ? (
        <button className={styles.selectionBarText} disabled={busy} onClick={onSelectAll} type="button">
          {dictionary.selectionSelectAll}
        </button>
      ) : null}
      <span className={styles.selectionBarSpacer} />
      <div className={styles.selectionBarActions}>
        {actions.map(action => (
          <button
            aria-label={action.label}
            className={action.destructive ? `${styles.selectionBarAction} ${styles.selectionBarDanger}` : styles.selectionBarAction}
            data-selection-action={action.key}
            disabled={busy || count === 0 || action.disabled}
            key={action.key}
            onClick={action.onClick}
            title={action.label}
            type="button"
          >
            <Glyph name={action.icon} size={18} />
            <span className={styles.selectionBarActionLabel}>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
    </div>
  );
  return target ? createPortal(bar, target) : null;
}
