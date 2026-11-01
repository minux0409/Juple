'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isSessionLost } from '../../../../../lib/authSession';
import { parseModerationNotice, type ModerationNotice } from '../../../../../lib/safety';
import { useSignedInApp } from '../../../AppRoot';
import { LoadFailed } from '../../../PageStates';
import { SettingsPage } from '../../SettingsPage';
import styles from '../../../app.module.css';

/**
 * 이용 안내 / 신고 처리 결과 - the operators' message to this person (the mobile ModerationNoticeScreen, on the same API). The words are the
 * operator's reviewed text, shown as plain text; the report itself (who reported, what they wrote) is never part of it.
 */
export default function ModerationNoticePage() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
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

  const isWarning = notice?.kind === 'warning';
  return (
    <SettingsPage backHref="/me" icon="Bell" title={isWarning ? dictionary.moderationWarningTitle : dictionary.moderationResultTitle} width="medium">
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
          <p>{isWarning ? dictionary.moderationWarningIntro : dictionary.moderationResultMessage}</p>
          {isWarning && notice.reason ? (
            <p data-notice-reason dir="auto">
              <strong>{dictionary.moderationReasonLabel}</strong>
              <br />
              {notice.reason}
            </p>
          ) : null}
          {isWarning && notice.guidance ? (
            <p data-notice-guidance dir="auto">
              <strong>{dictionary.moderationGuidanceLabel}</strong>
              <br />
              {notice.guidance}
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
