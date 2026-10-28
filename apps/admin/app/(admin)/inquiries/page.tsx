'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { inquiryStatusLabel, inquiryTypeLabel } from '../../../lib/adminModel';
import { INQUIRY_FILTERS_V2, atJupleId, formatSeoulInstant, inquiryLanguage, parseInquiryFilterV2, v2Paths, type InquiryRowV2 } from '../../../lib/adminV2';
import { strings } from '../../../lib/strings';
import { PageState } from '../AdminRoot';
import { usePagedList } from '../usePagedList';
import { LoadState, PageTitle, Panel } from '../v2/ui';

export default function InquiriesPage() {
  return (
    <Suspense fallback={<LoadState loading error={null} />}>
      <InquiryList />
    </Suspense>
  );
}

/** 문의 관리: 미답변 (접수 + 처리중) first by default, then 답변 완료 / 전체 - the existing 고객센터 inquiries, newest first. */
function InquiryList() {
  const router = useRouter();
  const filter = parseInquiryFilterV2(useSearchParams().get('status'));
  const list = usePagedList<InquiryRowV2>(filter, cursor => v2Paths.inquiries(filter, cursor));

  return (
    <>
      <PageTitle
        description="사용자가 어떤 언어로 문의해도 한국어로 읽고, 한국어로 답변을 작성한 뒤 사용자 언어로 번역해 보낼 수 있습니다."
        eyebrow="문의 관리"
        title="문의 관리"
      />
      <Panel>
        <div aria-label="처리 상태" className="v2-segmented" role="tablist">
          {INQUIRY_FILTERS_V2.map(entry => (
            <button
              aria-selected={entry.filter === filter}
              key={entry.filter}
              onClick={() => router.replace(entry.filter === 'Open' ? '/inquiries' : `/inquiries?status=${entry.filter}`)}
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
                <th scope="col">사용자</th>
                <th scope="col">문의 요약</th>
                <th scope="col">원문 언어</th>
                <th scope="col">처리 상태</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map(row => (
                <tr key={row.inquiryId}>
                  <td>{formatSeoulInstant(row.createdAtUtc)}</td>
                  <td className="ltr">{row.user ? atJupleId(row.user.jupleId) : strings.inquiryDeletedUser}</td>
                  <td className="preview">
                    <Link href={`/inquiries/${row.inquiryId}`}>
                      <span className="v2-muted">[{inquiryTypeLabel(row.type)}]</span> {row.contentPreview}
                    </Link>
                  </td>
                  <td>{inquiryLanguage(row)}</td>
                  <td>
                    <span className={`badge status-${row.status}`}>{inquiryStatusLabel(row.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && !list.error && list.items.length === 0 ? <p className="state">{filter === 'Open' ? '답변을 기다리는 문의가 없습니다.' : strings.empty}</p> : null}
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
