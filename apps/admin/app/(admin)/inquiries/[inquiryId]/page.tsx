'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import {
  adminPaths,
  auditActionLabel,
  displayJupleId,
  failureMessage,
  formatInstant,
  inquiryStatusLabel,
  inquiryTypeLabel,
  MAX_ANSWER_LENGTH,
  manualStatusTargets,
  validateAnswer,
  type InquiryDetail,
} from '../../../../lib/adminModel';
import { strings } from '../../../../lib/strings';
import { PageState, useAdmin, useAdminQuery } from '../../AdminRoot';

function parseId(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[1-9][0-9]{0,17}$/.test(text) ? Number(text) : null;
}

/**
 * One inquiry: what the person wrote, the app's diagnostics, the status (접수 <-> 처리중 by hand) and the answer. Both changes are
 * written by the API to the SAME support.SupportInquiries row the person reads in 고객센터 > 문의내역, with an audit record.
 */
export default function InquiryDetailPage() {
  const id = parseId(useParams<{ inquiryId: string }>().inquiryId);
  const { api, reportFailure } = useAdmin();
  const query = useAdminQuery<InquiryDetail>(id ? adminPaths.inquiry(id) : null);
  // The API's answer to the last change wins over the first read; the draft exists only once the admin has typed.
  const [updated, setUpdated] = useState<InquiryDetail | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const detail = updated ?? query.data;
  const answer = draft ?? detail?.answer ?? '';
  const setAnswer = setDraft;

  if (!id) {
    return <p className="state">{strings.notFound}</p>;
  }

  const mutate = async (request: () => Promise<InquiryDetail>) => {
    setBusy(true);
    setMessage(null);
    try {
      setUpdated(await request());
      setDraft(null);
      setMessage({ kind: 'ok', text: strings.saved });
    } catch (error) {
      reportFailure(error);
      setMessage({ kind: 'error', text: failureMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const saveAnswer = () => {
    const problem = validateAnswer(answer);
    if (problem) {
      setMessage({ kind: 'error', text: problem === 'empty' ? strings.answerEmpty : strings.answerTooLong });
      return;
    }
    if (!window.confirm(strings.answerConfirm)) {
      return;
    }
    void mutate(() => api<InquiryDetail>({ method: 'PUT', path: adminPaths.inquiryAnswer(id), body: { answer: answer.trim() } }));
  };

  return (
    <>
      <p>
        <Link href="/inquiries">← {strings.inquiryBack}</Link>
      </p>
      <PageState error={query.error} loading={query.loading && !detail} onRetry={query.reload} />
      {detail ? (
        <div className="detail">
          <header className="page-header">
            <h1>#{detail.inquiryId}</h1>
            <span className={`badge status-${detail.status}`}>{inquiryStatusLabel(detail.status)}</span>
          </header>

          <dl className="facts">
            <dt>{strings.inquiryType}</dt>
            <dd>{inquiryTypeLabel(detail.type)}</dd>
            <dt>{strings.inquiryUser}</dt>
            <dd className="ltr">
              {detail.user ? `${displayJupleId(detail.user.jupleId)}${detail.user.displayName ? ` (${detail.user.displayName})` : ''}` : strings.inquiryDeletedUser}
            </dd>
            <dt>{strings.inquiryCreatedAt}</dt>
            <dd>{formatInstant(detail.createdAtUtc)}</dd>
            <dt>{strings.inquiryUpdatedAt}</dt>
            <dd>{formatInstant(detail.updatedAtUtc)}</dd>
            <dt>{strings.inquiryAnsweredAt}</dt>
            <dd>{formatInstant(detail.answeredAtUtc)}</dd>
          </dl>

          <section>
            <h2>{strings.inquiryContent}</h2>
            <p className="user-text">{detail.content}</p>
          </section>

          <section>
            <h2>{strings.inquiryStatus}</h2>
            {manualStatusTargets(detail.status).length > 0 ? (
              <div className="actions">
                <span>{strings.changeStatusTo}</span>
                {manualStatusTargets(detail.status).map(target => (
                  <button
                    disabled={busy}
                    key={target}
                    onClick={() => void mutate(() => api<InquiryDetail>({ method: 'PUT', path: adminPaths.inquiryStatus(id), body: { status: target } }))}
                    type="button"
                  >
                    {inquiryStatusLabel(target)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{strings.statusLocked}</p>
            )}
          </section>

          <section>
            <h2>{strings.answerTitle}</h2>
            <p className="muted">{strings.answerHint}</p>
            <textarea
              disabled={busy}
              maxLength={MAX_ANSWER_LENGTH}
              onChange={event => setAnswer(event.target.value)}
              rows={8}
              value={answer}
            />
            <div className="actions">
              <span className="muted">
                {answer.trim().length} / {MAX_ANSWER_LENGTH}
              </span>
              <button className="primary" disabled={busy} onClick={saveAnswer} type="button">
                {detail.answer ? strings.answerReplace : strings.answerSave}
              </button>
            </div>
          </section>
          {message ? (
            <p className={message.kind === 'ok' ? 'notice ok' : 'notice error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
              {message.text}
            </p>
          ) : null}

          <section>
            <h2>{strings.inquiryDiagnostics}</h2>
            <dl className="facts">
              <dt>{strings.diagAppVersion}</dt>
              <dd>{detail.diagnostics.appVersion ?? '-'}</dd>
              <dt>{strings.diagBuildNumber}</dt>
              <dd>{detail.diagnostics.buildNumber ?? '-'}</dd>
              <dt>{strings.diagPlatform}</dt>
              <dd>{detail.diagnostics.platform ?? '-'}</dd>
              <dt>{strings.diagOsVersion}</dt>
              <dd>{detail.diagnostics.osVersion ?? '-'}</dd>
              <dt>{strings.diagDeviceModel}</dt>
              <dd>{detail.diagnostics.deviceModel ?? '-'}</dd>
              <dt>{strings.diagLocale}</dt>
              <dd>{detail.diagnostics.locale ?? '-'}</dd>
            </dl>
          </section>

          <section>
            <h2>{strings.inquiryHistory}</h2>
            {detail.history.length === 0 ? (
              <p className="muted">{strings.inquiryHistoryEmpty}</p>
            ) : (
              <ul className="history">
                {detail.history.map((entry, index) => (
                  <li key={`${entry.createdAtUtc}-${index}`}>
                    {formatInstant(entry.createdAtUtc)} · {auditActionLabel(entry.action)}
                    {entry.detail ? ` · ${entry.detail}` : ''} · <span className="ltr">{entry.adminJupleId ? displayJupleId(entry.adminJupleId) : `#${entry.adminUserId}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
