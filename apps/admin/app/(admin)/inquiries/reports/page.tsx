'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  REPORT_FILTERS,
  formatSeoulInstant,
  parseReportFilter,
  reportReasonLabel,
  reportReporterLabel,
  reportStatusLabel,
  reportTargetLabel,
  v2Paths,
  type ReportRow,
} from '../../../../lib/adminV2';
import { strings } from '../../../../lib/strings';
import { PageState } from '../../AdminRoot';
import { usePagedList } from '../../usePagedList';
import { LoadState, PageTitle, Panel } from '../../v2/ui';
import { InquiryTabs } from '../InquiryTabs';

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadState loading error={null} />}>
      <ReportList />
    </Suspense>
  );
}

/** 신고 관리: what is still open first (the default tab), newest first. Never shown to anyone but operators. */
function ReportList() {
  const router = useRouter();
  const filter = parseReportFilter(useSearchParams().get('status'));
  const list = usePagedList<ReportRow>(filter, cursor => v2Paths.reports(filter, cursor));

  return (
    <>
      <PageTitle
        description="공유 컬렉션의 신고와 자동 검사 결과를 검토합니다. 신고만으로 콘텐츠가 삭제되지 않으며, 신고자는 대상자에게 공개되지 않습니다."
        eyebrow="문의 관리"
        title="신고 관리"
      />
      <InquiryTabs active="reports" />
      <Panel>
        <div aria-label="처리 상태" className="v2-segmented" role="tablist">
          {REPORT_FILTERS.map(entry => (
            <button
              aria-selected={entry.filter === filter}
              key={entry.filter}
              onClick={() => router.replace(entry.filter === 'Open' ? '/inquiries/reports' : `/inquiries/reports?status=${entry.filter}`)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="v2-table-scroll">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">접수일</th>
                <th scope="col">대상</th>
                <th scope="col">사유</th>
                <th scope="col">상태</th>
                <th scope="col">신고자</th>
                <th scope="col">관리자 조치</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map(row => (
                <tr key={row.reportId}>
                  <td>{formatSeoulInstant(row.createdAtUtc)}</td>
                  <td className="preview">
                    <Link href={`/inquiries/reports/${row.reportId}`}>
                      <span className="v2-muted">[{reportTargetLabel(row.targetType)}]</span> {row.snapshotTitle ?? `#${row.targetId}`}
                    </Link>
                  </td>
                  <td>{reportReasonLabel(row.reason)}</td>
                  <td>{reportStatusLabel(row.status)}</td>
                  <td className="ltr">{reportReporterLabel(row)}</td>
                  <td>{row.adminActionTaken ? '있음' : '없음'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && !list.error && list.items.length === 0 ? <p className="state">해당하는 신고가 없습니다.</p> : null}
        <PageState error={list.error} loading={list.loading} onRetry={list.retry} />
        {list.hasMore && !list.loading && !list.error ? (
          <button className="load-more" onClick={list.loadMore} type="button">
            {strings.loadMore}
          </button>
        ) : null}
      </Panel>
    </>
  );
}
