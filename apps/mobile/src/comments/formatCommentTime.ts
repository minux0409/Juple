import type { TFunction } from 'i18next';
import { formatSavedLinkTimestamp } from '../components/SavedLinkMetaRow';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * When a comment was written, the way a conversation shows it: 방금 전 / N분 전 / N시간 전 for the
 * last day, then the date and time the app already formats everywhere (formatSavedLinkTimestamp, in
 * the user's language and time zone). A moment slightly in the future (clock drift) reads as 방금 전.
 */
export function formatCommentTime(createdAtUtc: string, t: TFunction, now: number = Date.now()): string {
  const age = now - new Date(createdAtUtc).getTime();
  if (age < MINUTE_MS) {
    return t('comments.justNow');
  }
  if (age < HOUR_MS) {
    return t('comments.minutesAgo', { count: Math.floor(age / MINUTE_MS) });
  }
  if (age < DAY_MS) {
    return t('comments.hoursAgo', { count: Math.floor(age / HOUR_MS) });
  }
  return formatSavedLinkTimestamp(createdAtUtc, 'dateTime');
}
