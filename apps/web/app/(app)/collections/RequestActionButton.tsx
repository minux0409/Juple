'use client';

import type { ComponentProps } from 'react';
import { formatBadgeCount } from '../../../lib/notifications';
import { Glyph } from '../Glyph';
import styles from '../app.module.css';

/**
 * One request entry of a Collection (받은 승인 요청, 참여 요청): a soft violet surface with its icon, the localized name (up to two
 * lines), the count as a badge and a chevron. Two of them sit side by side on a wide screen and stack on a narrow one or with a large
 * font (they wrap, never squeeze); the icon, badge and chevron never move however long the name is.
 */
export function RequestActionButton({
  label,
  count,
  accessibleLabel,
  icon,
  onClick,
  testId,
}: {
  readonly label: string;
  readonly count: number;
  readonly accessibleLabel: string;
  readonly icon: ComponentProps<typeof Glyph>['name'];
  readonly onClick: () => void;
  readonly testId: string;
}) {
  return (
    <button aria-haspopup="dialog" aria-label={accessibleLabel} className={styles.requestAction} data-request-action={testId} onClick={onClick} type="button">
      <span aria-hidden className={styles.requestActionIcon}>
        <Glyph name={icon} size={18} />
      </span>
      <span className={styles.requestActionLabel}>{label}</span>
      {count > 0 ? (
        <span aria-hidden className={styles.requestActionBadge} data-request-count>
          {formatBadgeCount(count)}
        </span>
      ) : null}
      <Glyph className={styles.requestActionChevron} name="Chevron" size={16} />
    </button>
  );
}
