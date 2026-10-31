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
  reportStatusLabel,
  reportTargetLabel,
  v2Paths,
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
    } catch (caught) {
      reportFailure(caught);
      setError((caught instanceof ApiHttpError ? reportFailureMessage(caught.code) : null) ?? failureMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const body = { note: note.trim() || null };
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
            <div><dt>대상</dt><dd>{reportTargetLabel(detail.targetType)} #{detail.targetId}{detail.targetExists ? '' : ' (삭제됨)'}</dd></div>
            <div><dt>사유</dt><dd>{reportReasonLabel(detail.reason)}</dd></div>
            <div><dt>신고자</dt><dd className="ltr">{reportReporterLabel(detail)}</dd></div>
            <div><dt>대상 소유자</dt><dd className="ltr">{detail.targetUser ? atJupleId(detail.targetUser.jupleId) : '-'}</dd></div>
            <div><dt>접수일</dt><dd>{formatSeoulInstant(detail.createdAtUtc)}</dd></div>
            {detail.reviewedAtUtc ? <div><dt>처리일</dt><dd>{formatSeoulInstant(detail.reviewedAtUtc)}</dd></div> : null}
            {detail.reviewedBy ? <div><dt>처리 관리자</dt><dd className="ltr">{atJupleId(detail.reviewedBy.jupleId)}</dd></div> : null}
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
            <button disabled={busy} onClick={() => void changeStatus('Actioned')} type="button">처리 완료</button>
          </div>
          {error ? <p className="v2-state" role="alert">{error}</p> : null}
        </Panel>
        <Panel>
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
