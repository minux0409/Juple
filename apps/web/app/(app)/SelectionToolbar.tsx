'use client';

import type { ComponentProps } from 'react';
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
 * for them, 전체 선택 when the page offers it, and 선택 종료. It floats at the bottom of the content (above the mobile-width tab row),
 * so it never pushes the list; it rises in with a short slide and leaves the same way.
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
  return (
    <div aria-label={dictionary.selectionSelectItems} className={styles.selectionBar} data-selection-bar role="toolbar">
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
  );
}
