'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiHttpError } from '../../../../../lib/adminApi';
import { auditActionLabel, failureMessage } from '../../../../../lib/adminModel';
import {
  atJupleId,
  formatSeoulInstant,
  reportFailureMessage,
  reportReasonLabel,
  reportReporterLabel,
  reportNoticeLabel,
  reportStatusLabel,
  reportTargetLabel,
  v2Paths,
  warningDraft,
  type ReportDetail,
} from '../../../../../lib/adminV2';
import { useAdmin, useAdminQuery } from '../../../AdminRoot';
import { LoadState, PageTitle, Panel } from '../../../v2/ui';
import { InquiryTabs } from '../../InquiryTabs';

function parseId(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[1-9][0-9]{0,17}$/.test(text) ? Number(text) : null;
}

/**
 * 신고 상세: what was reported (as it was and as it is now), why, the earlier reports of the same thing and what operators did. 공유 제한 deletes nothing and can be
 * lifted; every action here is audited by the API. User text is shown as plain text and an address is never made a link: an operator opens it deliberately.
 */
export default function ReportDetailPage() {
  const id = parseId(useParams<{ reportId: string }>().reportId);
  const query = useAdminQuery<ReportDetail>(id ? v2Paths.report(id) : null);
  const { api, reportFailure } = useAdmin();
  const [updated, setUpdated] = useState<ReportDetail | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 경고 / 삭제 / 계정 제한 are two steps: the operator reviews (and edits) what will happen, then confirms.
  const [pending, setPending] = useState<'warning' | 'delete' | 'restrict' | null>(null);
  const [warnReason, setWarnReason] = useState('');
  const [warnGuidance, setWarnGuidance] = useState('');
  // The words that reach the PERSON (an operator action notifies them): reviewed here, separate from the internal note above.
  const [userMessage, setUserMessage] = useState('');
  const detail = updated && updated.reportId === id ? updated : query.data;

  if (!id) {
    return <LoadState error="잘못된 신고 번호입니다." loading={false} />;
  }
  if (!detail) {
    return <LoadState error={query.error} loading={query.loading} onRetry={query.reload} />;
  }

  const run = async (request: () => Promise<ReportDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setUpdated(await request());
      setNote('');
      setUserMessage('');
      setPending(null);
    } catch (caught) {
      reportFailure(caught);
      setError((caught instanceof ApiHttpError ? reportFailureMessage(caught.code) : null) ?? failureMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const body = { note: note.trim() || null, message: userMessage.trim() || null };
  const changeStatus = (status: string) => run(() => api<ReportDetail>({ method: 'PUT', path: v2Paths.reportStatus(detail.reportId), body: { status, ...body } }));

  return (
    <>
      <PageTitle eyebrow="문의 관리" title={`신고 #${detail.reportId}`} />
      <InquiryTabs active="reports" />
      <div className="v2-inquiry">
        <Panel>
          <p><Link href="/inquiries/reports">목록으로</Link></p>
          <dl className="v2-facts">
            <div><dt>상태</dt><dd>{reportStatusLabel(detail.status)}</dd></div>
            <div><dt>대상</dt><dd>{reportTargetLabel(detail.targetType)} #{detail.targetId}{detail.targetExists ? '' : detail.targetType === 'Item' ? ' (컬렉션에서 제거됨)' : ' (삭제됨)'}</dd></div>
            <div><dt>사유</dt><dd>{reportReasonLabel(detail.reason)}</dd></div>
            <div><dt>신고자</dt><dd className="ltr">{reportReporterLabel(detail)}</dd></div>
            <div><dt>대상 소유자</dt><dd className="ltr">{detail.targetUser ? atJupleId(detail.targetUser.jupleId) : '-'}</dd></div>
            <div><dt>접수일</dt><dd>{formatSeoulInstant(detail.createdAtUtc)}</dd></div>
            {detail.reviewedAtUtc ? <div><dt>처리일</dt><dd>{formatSeoulInstant(detail.reviewedAtUtc)}</dd></div> : null}
            {detail.reviewedBy ? <div><dt>처리 관리자</dt><dd className="ltr">{atJupleId(detail.reviewedBy.jupleId)}</dd></div> : null}
            <div><dt>경고</dt><dd>{detail.warningSentAtUtc ? `발송됨 (${formatSeoulInstant(detail.warningSentAtUtc)}) · ${detail.warningAcknowledged ? '확인함' : '미확인'}` : '없음'}</dd></div>
            <div><dt>계정 이용 제한</dt><dd>{detail.targetAccountRestricted ? '적용 중' : '없음'}</dd></div>
            {detail.canDeleteTarget ? (
              detail.targetType === 'Item'
                ? <div><dt>제거 상태</dt><dd>{detail.targetDeleted ? '신고된 컬렉션에서 제거됨 (다시 추가 가능)' : '신고된 컬렉션에 있음'}</dd></div>
                : <div><dt>삭제 상태</dt><dd>{detail.targetDeleted ? '삭제됨 (복구 가능)' : '삭제되지 않음'}</dd></div>
            ) : null}
            {detail.collectionName ? <div><dt>컬렉션</dt><dd dir="auto">{detail.collectionName}{detail.collectionDeleted ? ' (삭제됨)' : ''}</dd></div> : null}
            <div><dt>사용자 통지</dt><dd>{detail.notices.length === 0 ? '없음' : `${detail.notices.length}건`}</dd></div>
            <div><dt>공유 제한</dt><dd>{detail.isRestricted ? `적용 중 (${detail.restrictedAtUtc ? formatSeoulInstant(detail.restrictedAtUtc) : ''})` : '없음'}</dd></div>
          </dl>
        </Panel>
        <Panel>
          <h2>신고 설명</h2>
          <p className="v2-user-text" dir="auto">{detail.details ?? '설명 없음'}</p>
          <h2>신고 당시 내용</h2>
          <p className="v2-user-text" dir="auto">{detail.snapshotTitle ?? '-'}</p>
          {detail.snapshotUrl ? <p className="v2-user-text ltr">{detail.snapshotUrl}</p> : null}
          <h2>현재 내용</h2>
          <p className="v2-user-text" dir="auto">{detail.currentTitle ?? '-'}</p>
          {detail.currentUrl ? <p className="v2-user-text ltr">{detail.currentUrl}</p> : null}
        </Panel>
        <Panel>
          <h2>조치</h2>
          <label>
            관리자 메모 (대상자에게 공개되지 않음)
            <textarea maxLength={1000} onChange={event => setNote(event.target.value)} value={note} />
          </label>
          <label>
            대상자에게 보낼 안내 문구 (삭제·제거·복구·공유 제한·계정 제한 조치는 작성자에게 알림으로 전달돼요. 비워두면 조치 내용만 안내해요)
            <textarea maxLength={1000} onChange={event => setUserMessage(event.target.value)} value={userMessage} />
          </label>
          <p className="v2-muted">신고자의 이름·연락처·신고 설명은 안내 문구에 넣지 마세요.</p>
          {detail.note ? <p className="v2-user-text" dir="auto">현재 메모: {detail.note}</p> : null}
          <div className="v2-actions">
            <button disabled={busy} onClick={() => void changeStatus('InReview')} type="button">검토 중</button>
            <button disabled={busy} onClick={() => void changeStatus('Dismissed')} type="button">조치 없음</button>
            {detail.canRestrict && !detail.isRestricted ? (
              <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportRestriction(detail.reportId), body }))} type="button">공유 제한</button>
            ) : null}
            {detail.canRestrict && detail.isRestricted ? (
              <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportRestrictionLift(detail.reportId), body }))} type="button">공유 제한 해제</button>
            ) : null}
            {detail.canWarn && !detail.warningSentAtUtc ? (
              <button
                disabled={busy}
                onClick={() => {
                  const draft = warningDraft(detail.reason);
                  setWarnReason(draft.reason);
                  setWarnGuidance(draft.guidance);
                  setPending('warning');
                }}
                type="button"
              >
                경고
              </button>
            ) : null}
            {detail.canDeleteTarget && !detail.targetDeleted ? <button disabled={busy} onClick={() => setPending('delete')} type="button">{detail.targetType === 'Collection' ? '컬렉션 삭제' : '컬렉션에서 제거'}</button> : null}
            {detail.canDeleteTarget && detail.targetDeleted ? (
              <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportTargetRestore(detail.reportId), body }))} type="button">{detail.targetType === 'Item' ? '컬렉션에 다시 추가' : '삭제 복구'}</button>
            ) : null}
            {detail.canRestrictAccount && !detail.targetAccountRestricted ? <button disabled={busy} onClick={() => setPending('restrict')} type="button">계정 이용 제한</button> : null}
            {detail.canRestrictAccount && detail.targetAccountRestricted ? (
              <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportAccountRestrictionLift(detail.reportId), body }))} type="button">계정 이용 제한 해제</button>
            ) : null}
            <button disabled={busy} onClick={() => void changeStatus('Actioned')} type="button">처리 완료</button>
          </div>
          {pending === 'warning' ? (
            <div className="v2-confirm" role="group" aria-label="경고 발송 확인">
              <h3>경고 메시지 검토</h3>
              <p className="v2-muted">아래 내용이 그대로 대상 사용자에게 알림으로 전달됩니다(앱 안내창 + 푸시). 신고자의 이름·연락처·신고 설명은 포함하지 마세요. 한 신고에 한 번만 보낼 수 있습니다.</p>
              <label>
                신고 내용 (검토한 사유)
                <textarea maxLength={500} onChange={event => setWarnReason(event.target.value)} value={warnReason} />
              </label>
              <label>
                관리자 안내
                <textarea maxLength={1000} onChange={event => setWarnGuidance(event.target.value)} value={warnGuidance} />
              </label>
              <div className="v2-actions">
                <button
                  disabled={busy || !warnReason.trim()}
                  onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportWarning(detail.reportId), body: { reason: warnReason.trim(), guidance: warnGuidance.trim() || null } }))}
                  type="button"
                >
                  경고 발송
                </button>
                <button disabled={busy} onClick={() => setPending(null)} type="button">취소</button>
              </div>
            </div>
          ) : null}
          {pending === 'delete' ? (
            <div className="v2-confirm" role="group" aria-label="삭제 확인">
              <h3>{detail.targetType === 'Collection' ? '컬렉션을 삭제할까요?' : '신고된 컬렉션에서 이 링크를 제거할까요?'}</h3>
              {detail.targetType === 'Collection' ? (
                <p className="v2-muted">휴지통으로 이동합니다(소유자의 삭제 이력). 데이터는 완전히 지워지지 않으며 &quot;삭제 복구&quot;로 되돌릴 수 있습니다. Owner 권한이 필요하고 감사 로그가 남습니다.</p>
              ) : (
                <p className="v2-muted">신고된 컬렉션에서만 제거됩니다. 사용자의 개인 저장 링크는 그대로 유지되고 삭제 이력(휴지통)으로 이동하지 않으며, 다른 컬렉션에도 영향이 없습니다. 링크를 추가한 사용자에게 운영팀 안내가 발송됩니다. 필요하면 &quot;컬렉션에 다시 추가&quot;로 되돌릴 수 있습니다. Owner 권한이 필요하고 감사 로그가 남습니다.</p>
              )}
              <div className="v2-actions">
                <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportTargetDelete(detail.reportId), body: { confirm: true, ...body } }))} type="button">{detail.targetType === 'Collection' ? '삭제하고 작성자에게 안내 발송' : '제거하고 작성자에게 안내 발송'}</button>
                <button disabled={busy} onClick={() => setPending(null)} type="button">취소</button>
              </div>
            </div>
          ) : null}
          {pending === 'restrict' ? (
            <div className="v2-confirm" role="group" aria-label="계정 이용 제한 확인">
              <h3>이 계정의 이용을 제한할까요?</h3>
              <p className="v2-muted">제한된 계정은 읽기·문의·계정 삭제만 할 수 있고 콘텐츠를 만들거나 바꿀 수 없습니다. 데이터는 삭제·숨김되지 않으며 언제든 해제할 수 있습니다. 신고 한 건만으로 자동 적용되지 않습니다. Owner 권한이 필요합니다.</p>
              <div className="v2-actions">
                <button disabled={busy} onClick={() => void run(() => api<ReportDetail>({ method: 'POST', path: v2Paths.reportAccountRestriction(detail.reportId), body: { confirm: true, ...body } }))} type="button">제한 확인</button>
                <button disabled={busy} onClick={() => setPending(null)} type="button">취소</button>
              </div>
            </div>
          ) : null}
          {error ? <p className="v2-state" role="alert">{error}</p> : null}
        </Panel>
        <Panel>
          <h2>사용자 통지 이력</h2>
          {detail.notices.length === 0 ? <p className="v2-muted">아직 대상자에게 보낸 안내가 없습니다. 삭제·제거·공유 제한·계정 제한 조치를 하면 자동으로 알림이 생성됩니다.</p> : (
            <ul>
              {detail.notices.map(notice => (
                <li key={notice.noticeId}>
                  {formatSeoulInstant(notice.createdAtUtc)} · {reportNoticeLabel(notice)} · {notice.acknowledgedAtUtc ? `확인함 (${formatSeoulInstant(notice.acknowledgedAtUtc)})` : '미확인'}
                </li>
              ))}
            </ul>
          )}
          <h2>이전 신고 이력</h2>
          {detail.priorReports.length === 0 ? <p className="v2-muted">없음</p> : (
            <ul>
              {detail.priorReports.map(prior => (
                <li key={prior.reportId}>
                  <Link href={`/inquiries/reports/${prior.reportId}`}>#{prior.reportId}</Link> {formatSeoulInstant(prior.createdAtUtc)} · {reportReasonLabel(prior.reason)} · {reportStatusLabel(prior.status)}
                </li>
              ))}
            </ul>
          )}
          <h2>관리자 처리 이력</h2>
          {detail.history.length === 0 ? <p className="v2-muted">없음</p> : (
            <ul>
              {detail.history.map(entry => (
                <li key={`${entry.action}-${entry.createdAtUtc}`}>
                  {formatSeoulInstant(entry.createdAtUtc)} · {auditActionLabel(entry.action)} · <span className="ltr">{entry.adminJupleId ? atJupleId(entry.adminJupleId) : '-'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
