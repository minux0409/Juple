'use client';

import { AttentionBadge } from '../AttentionBadge';
import { Glyph } from '../Glyph';
import styles from './RequestRow.module.css';

/**
 * 받은 승인 요청 / 받은 초대 요청 / 보낸 승인 요청: the same row for every pending-request entry, exactly as on mobile - the text is only the
 * name, the number is the red badge at the row's end (before the chevron). Zero never renders the row's number.
 */
export function RequestRow({
  label,
  count,
  accessibleLabel,
  expanded,
  onClick,
  testId,
  variant = 'action',
  statusText,
}: {
  readonly label: string;
  readonly count: number;
  readonly accessibleLabel: string;
  readonly expanded?: boolean;
  readonly onClick: () => void;
  readonly testId?: string;
  /** 'status' (my own sent requests, only waiting): a quiet neutral row with `statusText`, no badge. Default 'action': the blue row with a red badge. */
  readonly variant?: 'action' | 'status';
  readonly statusText?: string;
}) {
  return (
    <button aria-expanded={expanded} aria-haspopup="dialog" aria-label={accessibleLabel} className={variant === 'status' ? `${styles.row} ${styles.rowStatus}` : styles.row} data-request-row={testId} data-request-variant={variant} onClick={onClick} type="button">
      <Glyph className={styles.icon} name="Bell" size={18} />
      <span className={styles.label}>{label}</span>
      {variant === 'status' ? <span className={styles.statusText} data-request-status>{statusText}</span> : <AttentionBadge count={count} />}
      <Glyph className={styles.chevron} name="Chevron" size={16} />
    </button>
  );
}
