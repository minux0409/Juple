'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiHttpError } from '../../../../lib/adminApi';
import { auditActionLabel, failureMessage, inquiryStatusLabel, inquiryTypeLabel, manualStatusTargets } from '../../../../lib/adminModel';
import {
  LANGUAGES,
  answerBlocker,
  answerSendBody,
  atJupleId,
  formatSeoulInstant,
  languageName,
  translationErrorLabel,
  v2Paths,
  type AnswerDraftState,
  type InquiryDetailV2,
} from '../../../../lib/adminV2';
import { strings } from '../../../../lib/strings';
import { useAdmin, useAdminQuery } from '../../AdminRoot';
import { TranslateIcon } from '../../v2/Icons';
import { LoadState, PageTitle, Panel } from '../../v2/ui';

function parseId(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[1-9][0-9]{0,17}$/.test(text) ? Number(text) : null;
}

/**
 * 문의 상세: what the person wrote and its Korean translation side by side (the original is never changed), then the answer -
 * written in Korean, translated into the person's language, checked and only then sent. Nothing reaches the person before
 * 답변 전송, and a send over a change made meanwhile is refused by the API.
 */
export default function InquiryDetailPage() {
  const id = parseId(useParams<{ inquiryId: string }>().inquiryId);
  const query = useAdminQuery<InquiryDetailV2>(id ? v2Paths.inquiry(id) : null);
  const [updated, setUpdated] = useState<InquiryDetailV2 | null>(null);
  const detail = updated && updated.inquiryId === id ? updated : query.data;
  if (!id) {
    return <p className="state">{strings.notFound}</p>;
  }
  return (
    <>
      <PageTitle actions={<Link href="/inquiries">← 문의 목록</Link>} eyebrow="문의 관리" title={`문의 #${id}`} />
      <LoadState error={query.error} loading={query.loading && !detail} lines={6} onRetry={query.reload} />
      {detail ? <InquiryWorkspace detail={detail} key={`${detail.inquiryId}:${detail.changeToken}`} onChanged={setUpdated} onReload={() => { setUpdated(null); query.reload(); }} /> : null}
    </>
  );
}

function initialDraft(detail: InquiryDetailV2): AnswerDraftState {
  const draft = detail.answerDraft;
  if (draft) {
    // A saved draft keeps its Korean text and translation together, so that translation belongs to that Korean text.
    return {
      language: draft.language ?? detail.suggestedLanguage,
      sourceKo: draft.sourceKo ?? '',
      translated: draft.translated ?? '',
      translatedFrom: draft.translated ? draft.sourceKo : null,
      manualConfirmed: false,
    };
  }
  if (detail.answer) {
    const language = detail.answerLanguage ?? 'ko';
    const sourceKo = detail.answerSourceKo ?? (language === 'ko' ? detail.answer : '');
    return { language, sourceKo, translated: language === 'ko' ? '' : detail.answer, translatedFrom: language === 'ko' ? null : sourceKo, manualConfirmed: false };
  }
  return { language: detail.suggestedLanguage, sourceKo: '', translated: '', translatedFrom: null, manualConfirmed: false };
}

function InquiryWorkspace({ detail, onChanged, onReload }: { readonly detail: InquiryDetailV2; readonly onChanged: (detail: InquiryDetailV2) => void; readonly onReload: () => void }) {
  const { api, reportFailure } = useAdmin();
  const [draft, setDraft] = useState<AnswerDraftState>(() => initialDraft(detail));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ readonly kind: 'ok' | 'error'; readonly text: string } | null>(null);
  const machine = detail.translation;
  const canTranslate = machine?.configured === true && machine.allowed;
  const blocker = answerBlocker(draft);
  const update = (patch: Partial<AnswerDraftState>) => setDraft(previous => ({ ...previous, ...patch }));

  const run = async <T,>(label: string, request: () => Promise<T>, done: (result: T) => void) => {
    setBusy(label);
    setMessage(null);
    try {
      done(await request());
    } catch (error) {
      reportFailure(error);
      if (error instanceof ApiHttpError && error.code === 'inquiryChanged') {
        setMessage({ kind: 'error', text: '이 문의가 다른 곳에서 먼저 변경되었습니다. 최신 내용을 불러온 뒤 다시 확인하세요.' });
      } else if (error instanceof ApiHttpError && error.code) {
        setMessage({ kind: 'error', text: translationErrorLabel(error.code) });
      } else {
        setMessage({ kind: 'error', text: failureMessage(error) });
      }
    } finally {
      setBusy(null);
    }
  };

  const translateContent = () =>
    run('content', () => api<InquiryDetailV2>({ method: 'POST', path: v2Paths.inquiryContentTranslation(detail.inquiryId) }), onChanged);

  const saveDraft = () =>
    run(
      'draft',
      () => api<InquiryDetailV2>({ method: 'PUT', path: v2Paths.inquiryDraft(detail.inquiryId), body: { sourceKo: draft.sourceKo, translated: draft.language === 'ko' ? null : draft.translated, language: draft.language } }),
      () => setMessage({ kind: 'ok', text: '임시 저장했습니다. 사용자에게는 보이지 않습니다.' }),
    );

  const translateAnswer = () =>
    run(
      'answer',
      () => api<{ language: string; text: string }>({ method: 'POST', path: v2Paths.inquiryAnswerTranslation(detail.inquiryId), body: { sourceKo: draft.sourceKo, language: draft.language } }),
      result => update({ translated: result.text, translatedFrom: draft.sourceKo, manualConfirmed: false }),
    );

  const send = () => {
    if (blocker) {
      setMessage({ kind: 'error', text: blocker });
      return;
    }
    const preview = draft.language === 'ko' ? draft.sourceKo.trim() : draft.translated.trim();
    const confirmed = window.confirm(
      `${languageName(draft.language)}로 답변을 전송할까요?\n\n사용자에게 표시되는 답변:\n${preview.slice(0, 400)}${preview.length > 400 ? '…' : ''}\n\n전송하면 문의가 답변 완료로 바뀝니다.`,
    );
    if (!confirmed) {
      return;
    }
    void run('send', () => api<InquiryDetailV2>({ method: 'PUT', path: v2Paths.inquiryAnswer(detail.inquiryId), body: answerSendBody(draft, detail.changeToken) }), result => {
      onChanged(result);
    });
  };

  const changeStatus = (status: string) =>
    run('status', () => api<InquiryDetailV2>({ method: 'PUT', path: v2Paths.inquiryStatus(detail.inquiryId), body: { status } }), onChanged);

  const original = detail.contentTranslation;
  return (
    <div className="v2-inquiry">
      <Panel>
        <dl className="v2-facts">
          <div><dt>처리 상태</dt><dd><span className={`badge status-${detail.status}`}>{inquiryStatusLabel(detail.status)}</span></dd></div>
          <div><dt>유형</dt><dd>{inquiryTypeLabel(detail.type)}</dd></div>
          <div><dt>사용자</dt><dd className="ltr">{detail.user ? `${atJupleId(detail.user.jupleId)}${detail.user.displayName ? ` · ${detail.user.displayName}` : ''}` : strings.inquiryDeletedUser}</dd></div>
          <div><dt>접수일</dt><dd>{formatSeoulInstant(detail.createdAtUtc)}</dd></div>
          {detail.answeredAtUtc ? <div><dt>답변일</dt><dd>{formatSeoulInstant(detail.answeredAtUtc)}</dd></div> : null}
        </dl>
        {manualStatusTargets(detail.status).length ? (
          <div className="v2-actions">
            {manualStatusTargets(detail.status).map(target => (
              <button disabled={busy !== null} key={target} onClick={() => void changeStatus(target)} type="button">
                {inquiryStatusLabel(target)}(으)로 변경
              </button>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="v2-compare">
        <Panel title={<>사용자 원문 <span className="v2-muted">· {original?.language ? languageName(original.language) : detail.diagnostics.locale ? `${detail.diagnostics.locale} (기기 설정)` : '언어 미확인'}</span></>}>
          <p className="v2-user-text" lang={original?.language ?? undefined}>{detail.content}</p>
          <details className="v2-details">
            <summary>앱·기기 정보</summary>
            <dl className="v2-facts">
              <div><dt>{strings.diagAppVersion}</dt><dd>{detail.diagnostics.appVersion ?? '-'}</dd></div>
              <div><dt>{strings.diagBuildNumber}</dt><dd>{detail.diagnostics.buildNumber ?? '-'}</dd></div>
              <div><dt>{strings.diagPlatform}</dt><dd>{detail.diagnostics.platform ?? '-'}</dd></div>
              <div><dt>{strings.diagOsVersion}</dt><dd>{detail.diagnostics.osVersion ?? '-'}</dd></div>
              <div><dt>{strings.diagDeviceModel}</dt><dd>{detail.diagnostics.deviceModel ?? '-'}</dd></div>
              <div><dt>{strings.diagLocale}</dt><dd>{detail.diagnostics.locale ?? '-'}</dd></div>
            </dl>
          </details>
        </Panel>
        <Panel
          actions={
            canTranslate ? (
              <button disabled={busy !== null} onClick={() => void translateContent()} type="button">
                <TranslateIcon size={16} /> {original ? '재번역' : '한국어로 번역'}
              </button>
            ) : null
          }
          title="한국어 번역"
        >
          {original ? (
            <>
              <p className="v2-user-text" lang="ko">{original.textKo}</p>
              <p className="v2-footnote">자동 번역 · {formatSeoulInstant(original.translatedAtUtc)} · 원문은 바뀌지 않습니다.</p>
            </>
          ) : (
            <p className="v2-state">
              {busy === 'content'
                ? '번역 중…'
                : canTranslate
                  ? '아직 번역하지 않았습니다.'
                  : machine?.configured
                    ? translationErrorLabel('inquiryTranslationNotAllowed')
                    : translationErrorLabel('translationNotConfigured')}
            </p>
          )}
        </Panel>
      </div>

      <Panel title={detail.status === 'Answered' ? '답변 (전송됨 · 수정해서 다시 보낼 수 있습니다)' : '답변 작성'}>
        <div className="v2-compare">
          <div className="v2-compose">
            <label htmlFor="answer-ko">한국어 답변</label>
            <textarea disabled={busy !== null} id="answer-ko" maxLength={8000} onChange={event => update({ sourceKo: event.target.value })} rows={10} value={draft.sourceKo} />
            <div className="v2-actions">
              <span className="v2-muted">{draft.sourceKo.trim().length} / 8000</span>
              <button disabled={busy !== null || !draft.sourceKo.trim()} onClick={() => void saveDraft()} type="button">임시 저장</button>
              <button disabled={busy !== null || !canTranslate || draft.language === 'ko' || !draft.sourceKo.trim()} onClick={() => void translateAnswer()} type="button">
                <TranslateIcon size={16} /> {busy === 'answer' ? '번역 중…' : '번역하기'}
              </button>
            </div>
          </div>
          <div className="v2-compose">
            <label htmlFor="answer-language">사용자에게 보낼 언어</label>
            <select disabled={busy !== null} id="answer-language" onChange={event => update({ language: event.target.value, manualConfirmed: false })} value={draft.language}>
              {LANGUAGES.map(code => (
                <option key={code} value={code}>
                  {languageName(code)}{code === detail.suggestedLanguage ? ' (추천)' : ''}
                </option>
              ))}
            </select>
            {draft.language === 'ko' ? (
              <p className="v2-state">한국어 답변이 그대로 전송됩니다.</p>
            ) : (
              <>
                <textarea
                  aria-label={`${languageName(draft.language)} 번역문`}
                  disabled={busy !== null}
                  maxLength={8000}
                  onChange={event => update({ translated: event.target.value, manualConfirmed: false })}
                  placeholder={canTranslate ? '번역하기를 누르거나 직접 입력하세요.' : '번역 제공자가 없으면 번역문을 직접 입력하세요.'}
                  rows={10}
                  value={draft.translated}
                />
                {draft.translated.trim() && draft.translatedFrom?.trim() !== draft.sourceKo.trim() ? (
                  <label className="v2-confirm">
                    <input checked={draft.manualConfirmed} onChange={event => update({ manualConfirmed: event.target.checked })} type="checkbox" />
                    번역문이 현재 한국어 답변과 같은 내용임을 확인했습니다.
                  </label>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="v2-send">
          {blocker ? <p className="v2-muted">{blocker}</p> : <p className="v2-muted">{languageName(draft.language)}로 전송됩니다. 한국어 원문도 함께 보관됩니다.</p>}
          <button className="primary" disabled={busy !== null || blocker !== null} onClick={send} type="button">
            {busy === 'send' ? '전송 중…' : '답변 전송'}
          </button>
        </div>
        {message ? (
          <p className={message.kind === 'ok' ? 'notice ok' : 'notice error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
            {message.text}
            {message.kind === 'error' ? <> <button onClick={onReload} type="button">최신 내용 불러오기</button></> : null}
          </p>
        ) : null}
        {detail.answer ? (
          <details className="v2-details">
            <summary>전송된 답변 보기</summary>
            <p className="v2-footnote">사용자에게 표시된 답변 ({languageName(detail.answerLanguage ?? 'ko')}):</p>
            <p className="v2-user-text">{detail.answer}</p>
            {detail.answerSourceKo && detail.answerSourceKo !== detail.answer ? (
              <>
                <p className="v2-footnote">한국어 원문:</p>
                <p className="v2-user-text">{detail.answerSourceKo}</p>
              </>
            ) : null}
          </details>
        ) : null}
      </Panel>

      <Panel title={strings.inquiryHistory}>
        {detail.history.length === 0 ? (
          <p className="v2-muted">{strings.inquiryHistoryEmpty}</p>
        ) : (
          <ul className="v2-history">
            {detail.history.map((entry, index) => (
              <li key={`${entry.createdAtUtc}-${index}`}>
                <span>{formatSeoulInstant(entry.createdAtUtc)}</span>
                <span>{auditActionLabel(entry.action)}{entry.detail ? ` · ${entry.detail}` : ''}</span>
                <span className="ltr v2-muted">{entry.adminJupleId ? atJupleId(entry.adminJupleId) : `#${entry.adminUserId}`}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
