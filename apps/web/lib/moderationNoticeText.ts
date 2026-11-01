import type { AppDictionary } from './appI18n.ts';
import { formatMessage } from './appI18n.ts';
import { REPORT_REASONS, reportReasonLabel, type ModerationNotice } from './safety.ts';

/**
 * What an operator ACTION says, in the person's language, from the notice's snapshot (what was done, and the content's title as it was then) - the
 * mobile ModerationNoticeScreen's sentence, from the same translations. An account action has no content: one sentence each.
 */
export function moderationActionSentence(notice: ModerationNotice, dictionary: AppDictionary): string | null {
  if (notice.kind !== 'action' || notice.actionType === null) {
    return null;
  }
  const title = notice.contentTitle ?? '';
  const collection = notice.contentType === 'Collection';
  switch (notice.actionType) {
    case 'contentDeleted':
      return formatMessage(collection ? dictionary.moderationActionContentDeletedCollection : dictionary.moderationActionContentDeletedLink, { title });
    case 'contentRestored':
      return formatMessage(collection ? dictionary.moderationActionContentRestoredCollection : dictionary.moderationActionContentRestoredLink, { title });
    case 'shareRestricted':
      return formatMessage(collection ? dictionary.moderationActionShareRestrictedCollection : dictionary.moderationActionShareRestrictedLink, { title });
    case 'shareRestrictionLifted':
      return formatMessage(collection ? dictionary.moderationActionShareRestrictionLiftedCollection : dictionary.moderationActionShareRestrictionLiftedLink, { title });
    case 'accountRestricted':
      return dictionary.moderationActionAccountRestricted;
    case 'accountRestrictionLifted':
      return dictionary.moderationActionAccountRestrictionLifted;
  }
}

/** The report's reason code in the person's language; null for a code this app does not know (nothing is guessed). */
export function moderationReasonWords(code: string, dictionary: AppDictionary): string | null {
  return (REPORT_REASONS as readonly string[]).includes(code) ? reportReasonLabel(code as (typeof REPORT_REASONS)[number], dictionary) : null;
}

/** The short word for what the operators did (조치: 경고). */
export function moderationActionLabel(notice: ModerationNotice, dictionary: AppDictionary): string | null {
  if (notice.kind === 'warning') {
    return dictionary.moderationActionTypeWarning;
  }
  switch (notice.actionType) {
    case 'contentDeleted':
      return dictionary.moderationActionTypeContentDeleted;
    case 'contentRestored':
      return dictionary.moderationActionTypeContentRestored;
    case 'shareRestricted':
      return dictionary.moderationActionTypeShareRestricted;
    case 'shareRestrictionLifted':
      return dictionary.moderationActionTypeShareRestrictionLifted;
    case 'accountRestricted':
      return dictionary.moderationActionTypeAccountRestricted;
    case 'accountRestrictionLifted':
      return dictionary.moderationActionTypeAccountRestrictionLifted;
    default:
      return null;
  }
}
