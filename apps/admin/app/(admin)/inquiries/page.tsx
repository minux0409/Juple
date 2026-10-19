'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  adminPaths,
  displayJupleId,
  formatInstant,
  INQUIRY_FILTERS,
  inquiryStatusLabel,
  inquiryTypeLabel,
  parseInquiryFilter,
  type InquiryRow,
} from '../../../lib/adminModel';
import { strings } from '../../../lib/strings';
import { PageState } from '../AdminRoot';
import { usePagedList } from '../usePagedList';

export default function InquiriesPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <InquiryList />
    </Suspense>
  );
}

/** 문의: the existing 고객센터 inquiries, newest first, filtered by 전체 / 접수 / 처리중 / 답변완료 (kept in the URL: ?status=). */
function InquiryList() {
  const router = useRouter();
  const status = parseInquiryFilter(useSearchParams().get('status'));
  const list = usePagedList<InquiryRow>(status ?? 'all', cursor => adminPaths.inquiries(status, cursor));

  return (
    <>
      <header className="page-header">
        <h1>{strings.inquiriesTitle}</h1>
      </header>
      <div className="tabs" role="tablist">
        {INQUIRY_FILTERS.map(filter => (
          <button
            aria-selected={filter.status === status}
            key={filter.label}
            onClick={() => router.replace(filter.status ? `/inquiries?status=${filter.status}` : '/inquiries')}
            role="tab"
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <table>
        <thead>
          <tr>
            <th>{strings.inquiryNumber}</th>
            <th>{strings.inquiryStatus}</th>
            <th>{strings.inquiryType}</th>
            <th>{strings.inquiryUser}</th>
            <th>{strings.inquiryContent}</th>
            <th>{strings.inquiryPlatform}</th>
            <th>{strings.inquiryCreatedAt}</th>
          </tr>
        </thead>
        <tbody>
          {list.items.map(row => (
            <tr key={row.inquiryId}>
              <td>
                <Link href={`/inquiries/${row.inquiryId}`}>#{row.inquiryId}</Link>
              </td>
              <td>
                <span className={`badge status-${row.status}`}>{inquiryStatusLabel(row.status)}</span>
              </td>
              <td>{inquiryTypeLabel(row.type)}</td>
              <td className="ltr">{row.user ? displayJupleId(row.user.jupleId) : strings.inquiryDeletedUser}</td>
              <td className="preview">
                <Link href={`/inquiries/${row.inquiryId}`}>{row.contentPreview}</Link>
              </td>
              <td>{row.platform ?? '-'}</td>
              <td>{formatInstant(row.createdAtUtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.loading && !list.error && list.items.length === 0 ? <p className="state">{strings.empty}</p> : null}
      <PageState error={list.error} loading={list.loading} onRetry={list.retry} />
      {list.hasMore && !list.loading && !list.error ? (
        <button className="load-more" onClick={list.loadMore} type="button">
          {strings.loadMore}
        </button>
      ) : null}
    </>
  );
}
