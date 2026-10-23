import { formatBadgeCount } from '../../lib/notifications';
import styles from './AttentionBadge.module.css';

export function AttentionBadge({ count }: { readonly count: number }) {
  return count > 0 ? <span aria-label={String(count)} className={styles.badge} data-attention-badge>{formatBadgeCount(count)}</span> : null;
}
