import type { TFunction } from 'i18next';

/** What one bulk action did, item by item. `skipped`: left alone on purpose (not allowed for that item, or already done). */
export interface BulkTally {
  readonly succeeded: number;
  readonly failed: number;
  readonly skipped?: number;
}

/**
 * The one sentence a bulk action reports. A partial success is never worded as a full one: when anything failed the message says how
 * many of how many went through and that the failed ones stay selected for another try.
 * `allKey` / `partialKey` are the action's own i18n keys ({{count}} / {{ok}} / {{total}}); the shared skipped / failed lines follow.
 */
export function formatBulkResult(t: TFunction, tally: BulkTally, keys: { readonly allKey: string; readonly partialKey: string }): string {
  const skipped = tally.skipped ?? 0;
  const total = tally.succeeded + tally.failed;
  const lines: string[] = [];
  if (tally.failed === 0) {
    lines.push(t(keys.allKey, { count: tally.succeeded }));
  } else if (tally.succeeded === 0) {
    lines.push(t('selection.resultNoneSucceeded', { count: tally.failed }));
  } else {
    lines.push(t(keys.partialKey, { ok: tally.succeeded, total }));
  }
  if (skipped > 0) {
    lines.push(t('selection.resultSkipped', { count: skipped }));
  }
  if (tally.failed > 0) {
    lines.push(t('selection.resultFailedKept', { count: tally.failed }));
  }
  return lines.join(' ');
}
