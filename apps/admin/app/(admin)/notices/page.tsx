'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePagedList } from '../usePagedList';
import { PageState } from '../AdminRoot';
import { formatInstant } from '../../../lib/adminModel';
import { adminNoticeListPath, publicationState, type AdminNoticeRow } from '../../../lib/notices';
import { LANGUAGES } from '../../../lib/adminV2';
import { PageTitle, Panel } from '../v2/ui';

/** 공지사항: every notice with its state and languages; opening one shows the Korean original and its translations. */
export default function NoticeListPage() {
  const savedId = Number(useSearchParams().get('saved'));
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<AdminNoticeRow & { languageCount?: number }>(`${search}#${status}`, cursor => adminNoticeListPath(search, status, cursor));
  const saved = list.items.find(notice => notice.id === savedId);
  return (
    <>
      <PageTitle
        actions={<Link className="v2-button primary" href="/notices/new">공지 작성</Link>}
        description="한국어로 작성하면 지원 언어 17개로 번역할 수 있습니다. 번역이 없는 언어의 사용자에게는 한국어 원본이 표시됩니다."
        eyebrow="공지사항"
        title="공지사항"
      />
      {saved ? (
        <p className="state" role="status">
          공지를 저장했습니다. ({publicationState(saved)})
        </p>
      ) : null}
      <Panel>
        <form
          className="v2-toolbar"
          onSubmit={event => {
            event.preventDefault();
            setSearch(term);
          }}
        >
          <input aria-label="제목 검색" maxLength={200} onChange={e => setTerm(e.target.value)} placeholder="제목 검색" value={term} />
          <select aria-label="게시 상태" onChange={e => setStatus(e.target.value)} value={status}>
            <option value="">전체 상태</option>
            <option value="Draft">초안 / 중단</option>
            <option value="Published">게시 / 예약 / 종료</option>
          </select>
          <button type="submit">검색</button>
        </form>
        <div className="v2-table-scroll">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">제목</th>
                <th scope="col">작성일</th>
                <th scope="col">게시 상태</th>
                <th scope="col">대상 언어</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map(n => (
                <tr key={n.id}>
                  <td>
                    <Link href={`/notices/${n.id}`}>{n.title}</Link>
                    {n.isImportant ? <span className="v2-badge v2-state-machine">중요</span> : null}
                    {n.isPinned ? <span className="v2-badge">고정</span> : null}
                  </td>
                  <td>{formatInstant(n.createdAtUtc)}</td>
                  <td>{publicationState(n)}</td>
                  <td>{n.languageCount ? `${n.languageCount} / ${LANGUAGES.length}개 언어` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.loading && !list.error && !list.items.length ? <p className="state">등록된 공지사항이 없습니다.</p> : null}
        <PageState error={list.error} loading={list.loading} onRetry={list.retry} />
        {list.hasMore && !list.loading ? (
          <button className="load-more" onClick={list.loadMore} type="button">
            더 보기
          </button>
        ) : null}
      </Panel>
    </>
  );
}
