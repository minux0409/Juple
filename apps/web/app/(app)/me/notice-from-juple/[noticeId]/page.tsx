'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isSessionLost } from '../../../../../lib/authSession';
import { formatMessage } from '../../../../../lib/appI18n';
import { moderationActionLabel, moderationActionSentence, moderationReasonWords } from '../../../../../lib/moderationNoticeText';
import { parseModerationNotice, type ModerationNotice } from '../../../../../lib/safety';
import { useSignedInApp } from '../../../AppRoot';
import { LoadFailed } from '../../../PageStates';
import { SettingsPage } from '../../SettingsPage';
import { LinkImage } from '../../../LinkImage';
import { Glyph } from '../../../Glyph';
import styles from '../../../app.module.css';

/**
 * 이용 안내 / 신고 처리 결과 - the operators' message to this person (the mobile ModerationNoticeScreen, on the same API). The words are the
 * operator's reviewed text, shown as plain text; the report itself (who reported, what they wrote) is never part of it.
 */
export default function ModerationNoticePage() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const raw = useParams<{ noticeId: string }>().noticeId;
  const id = /^[1-9][0-9]{0,17}$/.test(raw ?? '') ? Number(raw) : null;
  const [notice, setNotice] = useState<ModerationNotice | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const load = useCallback(() => {
    if (id === null) {
      return;
    }
    api<unknown>({ method: 'GET', path: `/api/v1/moderation-notices/${id}` }).then(
      value => {
        const parsed = parseModerationNotice(value);
        setNotice(parsed);
        setFailed(parsed === null);
      },
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
  }, [api, id, onSessionLost]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledge = () => {
    if (!notice || saving) {
      return;
    }
    setSaving(true);
    setSaveFailed(false);
    api<void>({ method: 'POST', path: `/api/v1/moderation-notices/${notice.id}/acknowledge` }).then(
      () => {
        setSaving(false);
        setNotice({ ...notice, acknowledgedAtUtc: notice.acknowledgedAtUtc ?? new Date().toISOString() });
      },
      caught => {
        setSaving(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setSaveFailed(true);
      },
    );
  };

  const isResult = notice?.kind === 'reportResult';
  const intro = notice ? (isResult ? dictionary.moderationResultMessage : moderationActionSentence(notice, dictionary) ?? dictionary.moderationWarningIntro) : '';
  const reasonCodeWords = notice?.reasonCode ? moderationReasonWords(notice.reasonCode, dictionary) : null;
  const actionWords = notice ? moderationActionLabel(notice, dictionary) : null;
  return (
    <SettingsPage backHref="/me" icon="Bell" title={isResult ? dictionary.moderationResultTitle : dictionary.moderationTeamTitle} width="medium">
      {failed || id === null ? (
        <LoadFailed
          dictionary={dictionary}
          onRetry={() => {
            setFailed(false);
            load();
          }}
        />
      ) : null}
      {notice ? (
        <section className={styles.settingsCard} data-moderation-notice>
          <p data-notice-intro>{intro}</p>
          {!isResult && notice.contentType && (notice.contentTitle || notice.collectionName) ? (
            <div data-notice-target style={{ alignItems: 'center', display: 'flex', gap: 12, minWidth: 0 }}>
              {notice.contentType === 'Item' ? <NoticeLinkImage src={notice.contentImageUrl} /> : null}
              <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                {notice.contentTitle ? <strong data-notice-content dir="auto">{notice.contentTitle}</strong> : null}
                {notice.collectionName ? (
                  <p className={styles.profileId} data-notice-collection dir="auto">{formatMessage(dictionary.moderationSharedCollectionLine, { name: notice.collectionName })}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          {!isResult && actionWords ? (
            <p data-notice-action>
              <strong>{dictionary.moderationActionLabel}</strong>
              <br />
              {actionWords}
            </p>
          ) : null}
          {!isResult && reasonCodeWords ? (
            <p data-notice-reason-code>
              <strong>{dictionary.moderationReasonCodeLabel}</strong>
              <br />
              {reasonCodeWords}
            </p>
          ) : null}
          {!isResult && notice.reason ? (
            <p data-notice-reason dir="auto">
              <strong>{dictionary.moderationReasonLabel}</strong>
              <br />
              {notice.reason}
            </p>
          ) : null}
          {!isResult && notice.guidance ? (
            <p data-notice-guidance dir="auto">
              <strong>{dictionary.moderationGuidanceLabel}</strong>
              <br />
              {notice.guidance}
            </p>
          ) : null}
          {!isResult && notice.createdAtUtc ? (
            <p className={styles.profileId} data-notice-date>
              {dictionary.moderationActedAtLabel} · {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notice.createdAtUtc))}
            </p>
          ) : null}
          {saveFailed ? <p className={styles.fieldError} role="alert">{dictionary.moderationAcknowledgeFailed}</p> : null}
          {notice.acknowledgedAtUtc ? (
            <p className={styles.profileId} data-notice-acknowledged>{dictionary.moderationAcknowledged}</p>
          ) : (
            <button className={styles.primaryAction} data-notice-acknowledge disabled={saving} onClick={acknowledge} type="button">
              {dictionary.moderationAcknowledge}
            </button>
          )}
        </section>
      ) : null}
    </SettingsPage>
  );
}

/** The link's picture as kept in the notice; the link placeholder when there is none or it no longer loads. */
function NoticeLinkImage({ src }: { readonly src: string | null }) {
  return (
    <div className={styles.thumbnail} data-notice-image>
      <LinkImage fallback={<span className={styles.thumbnailFallback}><Glyph name="Link" size={22} /></span>} src={src} />
    </div>
  );
}
