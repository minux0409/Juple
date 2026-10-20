import type { DataRetention } from '../auth/types';

/** The words and server dates a retention notice shows. Pure: every date is the server's, nothing is computed here. */
export interface DataRetentionView {
  readonly titleKey: string;
  readonly bodyKey: string;
  /** The date the body names ({{date}}) - the end of the retention period; null when the body names none. */
  readonly bodyDateUtc: string | null;
  readonly rows: readonly { readonly id: 'accessEnded' | 'deletionScheduled' | 'nextNotice'; readonly labelKey: string; readonly valueUtc: string }[];
}

export function describeDataRetention(retention: DataRetention | null | undefined): DataRetentionView | null {
  if (!retention) {
    return null;
  }
  if (retention.phase === 'billingHold') {
    return { titleKey: 'retention.billingHoldTitle', bodyKey: 'retention.billingHoldBody', bodyDateUtc: null, rows: [] };
  }
  const rows: DataRetentionView['rows'][number][] = [];
  if (retention.accessEndedAtUtc) {
    rows.push({ id: 'accessEnded', labelKey: 'retention.rowAccessEnded', valueUtc: retention.accessEndedAtUtc });
  }
  if (retention.deletionScheduledAtUtc) {
    rows.push({ id: 'deletionScheduled', labelKey: 'retention.rowDeletionScheduled', valueUtc: retention.deletionScheduledAtUtc });
  }
  if (retention.nextNoticeAtUtc) {
    rows.push({ id: 'nextNotice', labelKey: 'retention.rowNextNotice', valueUtc: retention.nextNoticeAtUtc });
  }
  // Without a scheduled date there is nothing honest to say about "until when" - the body then names no date.
  if (!retention.deletionScheduledAtUtc) {
    return { titleKey: 'retention.readOnlyTitle', bodyKey: 'retention.readOnlyBodyNoDate', bodyDateUtc: null, rows };
  }
  return retention.phase === 'deletionDue'
    ? { titleKey: 'retention.deletionDueTitle', bodyKey: 'retention.deletionDueBody', bodyDateUtc: retention.deletionScheduledAtUtc, rows }
    : { titleKey: 'retention.readOnlyTitle', bodyKey: 'retention.readOnlyBody', bodyDateUtc: retention.deletionScheduledAtUtc, rows };
}

/** A date in the app language, medium style (e.g. "2027. 7. 15." / "Jul 15, 2027"), in the device's own time zone. */
export function formatRetentionDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}
