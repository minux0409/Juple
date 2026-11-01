import type { TFunction } from 'i18next';
import type { ModerationNotice } from './moderationNoticeApi';
import { REPORT_REASONS } from './safetyApi';

/**
 * What an operator action says, in the person's language, from the notice's snapshot (what was done, and the title of the content as it was
 * then): "회원님이 공유한 '제목'이(가) 운영정책에 따라 삭제되었습니다." The title is a parameter of the translated sentence, never glued on by hand.
 * An account action has no content: one sentence each.
 */
export function moderationActionSentence(notice: ModerationNotice, t: TFunction): string | null {
  if (notice.kind !== 'action' || notice.actionType === null) {
    return null;
  }
  const pascal = `${notice.actionType.charAt(0).toUpperCase()}${notice.actionType.slice(1)}`;
  const isAccount = notice.actionType === 'accountRestricted' || notice.actionType === 'accountRestrictionLifted';
  const suffix = isAccount ? '' : notice.contentType === 'Collection' ? 'Collection' : 'Link';
  return t(`moderation.action${pascal}${suffix}`, { title: notice.contentTitle ?? '' });
}

/** The report's reason code in the person's own language; null for a code the app does not know (nothing is guessed). */
export function moderationReasonLabel(notice: Pick<ModerationNotice, 'reasonCode'>, t: TFunction): string | null {
  return notice.reasonCode !== null && (REPORT_REASONS as readonly string[]).includes(notice.reasonCode) ? t(`safety.reason${notice.reasonCode}`) : null;
}

/** The short word for what the operators did (조치: 경고), in the person's language. */
export function moderationActionLabel(notice: ModerationNotice, t: TFunction): string | null {
  if (notice.kind === 'warning') {
    return t('moderation.actionTypeWarning');
  }
  if (notice.kind !== 'action' || notice.actionType === null) {
    return null;
  }
  return t(`moderation.actionType${notice.actionType.charAt(0).toUpperCase()}${notice.actionType.slice(1)}`);
}
