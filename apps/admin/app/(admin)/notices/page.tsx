'use client';
import Link from 'next/link';
import { useState } from 'react';
import { usePagedList } from '../usePagedList';
import { PageState } from '../AdminRoot';
import { formatInstant } from '../../../lib/adminModel';
import {
  adminNoticeListPath,
  publicationState,
  type AdminNoticeRow,
} from '../../../lib/notices';
export default function NoticeListPage() {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<AdminNoticeRow>(`${search}#${status}`, (cursor) =>
    adminNoticeListPath(search, status, cursor),
  );
  return (
    <>
      <header className="page-header">
        <h1>공지사항 관리</h1>
        <Link href="/notices/new">공지 작성</Link>
      </header>
      <form
        className="expense-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(term);
        }}
      >
        <label>
          제목 검색
          <input
            value={term}
            maxLength={200}
            onChange={(e) => setTerm(e.target.value)}
          />
        </label>
        <label>
          게시 상태
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">전체</option>
            <option value="Draft">초안 / 중단</option>
            <option value="Published">게시 / 예약 / 종료</option>
          </select>
        </label>
        <button type="submit">검색</button>
      </form>
      <div className="expense-table">
        <table>
          <thead>
            <tr>
              <th>제목</th>
              <th>상태</th>
              <th>중요 / 고정</th>
              <th>작성일</th>
              <th>게시일</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((n) => (
              <tr key={n.id}>
                <td>
                  <Link href={`/notices/${n.id}`}>{n.title}</Link>
                </td>
                <td>{publicationState(n)}</td>
                <td>
                  {n.isImportant ? '중요 ' : ''}
                  {n.isPinned ? '고정' : ''}
                </td>
                <td>{formatInstant(n.createdAtUtc)}</td>
                <td>{formatInstant(n.startsAtUtc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.loading && !list.error && !list.items.length ? (
        <p className="state">등록된 공지사항이 없습니다.</p>
      ) : null}
      <PageState
        error={list.error}
        loading={list.loading}
        onRetry={list.retry}
      />
      {list.hasMore && !list.loading ? (
        <button className="load-more" onClick={list.loadMore} type="button">
          더 보기
        </button>
      ) : null}
    </>
  );
}
