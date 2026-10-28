'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import {
  atJupleId,
  formatDay,
  formatMonth,
  formatNumber,
  formatSeoulInstant,
  languageName,
  nextSort,
  pageCount,
  shortAxisDay,
  sortDirection,
  v2Paths,
  type UserDirectoryPage,
  type UserDirectoryQuery,
  type UserLinkHistory,
  type UserSearchField,
} from '../../../lib/adminV2';
import { Chart } from '../v2/Chart';
import { LoadState, PageTitle, Panel, Segmented } from '../v2/ui';
import { useAdminResource } from '../v2/useAdminResource';

export default function UsersPage() {
  return (
    <Suspense fallback={<LoadState loading error={null} />}>
      <Users />
    </Suspense>
  );
}

const PAGE_SIZE = 20;

/**
 * 사용자: the top half is the account table (server-side search, sort, language filter and pages), the bottom half the selected
 * person's saving history from their sign-up day. The selection is in the URL (?user=), so a reload keeps it.
 */
function Users() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = Number(params.get('user')) || null;
  const [input, setInput] = useState('');
  const [field, setField] = useState<UserSearchField>('jupleId');
  const [query, setQuery] = useState<UserDirectoryQuery>({ search: '', searchField: 'jupleId', language: '', sort: 'createdDesc', page: 1, pageSize: PAGE_SIZE });
  const list = useAdminResource<UserDirectoryPage>(v2Paths.users(query), 30_000);
  const pages = list.data ? pageCount(list.data.total, list.data.pageSize) : 1;

  const select = (userId: number) => router.replace(`/users?user=${userId}`, { scroll: false });
  const sortHeader = (column: 'created' | 'links', label: string) => (
    <th aria-sort={sortDirection(query.sort, column)} scope="col">
      <button className="v2-sort" onClick={() => setQuery(previous => ({ ...previous, sort: nextSort(previous.sort, column), page: 1 }))} type="button">
        {label}
        <span aria-hidden="true">{sortDirection(query.sort, column) === 'ascending' ? '↑' : sortDirection(query.sort, column) === 'descending' ? '↓' : '↕'}</span>
      </button>
    </th>
  );

  return (
    <div className="v2-users">
      <PageTitle eyebrow="사용자" title="사용자" />
      <Panel className="v2-users-list">
        <form
          className="v2-toolbar"
          onSubmit={event => {
            event.preventDefault();
            setQuery(previous => ({ ...previous, search: input, searchField: field, page: 1 }));
          }}
        >
          <select aria-label="검색 항목" onChange={event => setField(event.target.value as UserSearchField)} value={field}>
            <option value="jupleId">사용자 아이디</option>
            <option value="nickname">닉네임</option>
          </select>
          <input
            aria-label="검색어"
            autoComplete="off"
            maxLength={50}
            onChange={event => setInput(event.target.value)}
            placeholder={field === 'jupleId' ? '@K7MP4Q8N (앞부분만 입력해도 됩니다)' : '닉네임 일부'}
            value={input}
          />
          <button className="primary" type="submit">검색</button>
          <select
            aria-label="언어"
            onChange={event => setQuery(previous => ({ ...previous, language: event.target.value, page: 1 }))}
            value={query.language}
          >
            <option value="">모든 언어</option>
            {(list.data?.languages ?? []).map(language => (
              <option key={language.language} value={language.language}>
                {languageName(language.language)} ({formatNumber(language.users)})
              </option>
            ))}
          </select>
          {query.search || query.language ? (
            <button
              onClick={() => {
                setInput('');
                setQuery(previous => ({ ...previous, search: '', language: '', page: 1 }));
              }}
              type="button"
            >
              초기화
            </button>
          ) : null}
        </form>
        <div className="v2-table-scroll v2-users-table">
          <table className="v2-table">
            <thead>
              <tr>
                <th scope="col">사용자 아이디</th>
                <th scope="col">닉네임</th>
                {sortHeader('links', '저장 링크 개수')}
                <th scope="col">언어</th>
                {sortHeader('created', '가입일')}
              </tr>
            </thead>
            <tbody>
              {(list.data?.items ?? []).map(user => (
                <tr
                  aria-selected={user.userId === selectedId}
                  className="v2-row-button"
                  key={user.userId}
                  onClick={() => select(user.userId)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      select(user.userId);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="ltr">{atJupleId(user.jupleId)}</td>
                  <td>{user.displayName ?? <span className="v2-muted">-</span>}</td>
                  <td className="num">{formatNumber(user.linkCount)}</td>
                  <td title={user.preferredLocale}>{languageName(user.language)}</td>
                  <td>{formatSeoulInstant(user.createdAtUtc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <LoadState
          empty={list.data?.items.length === 0}
          emptyText="조건에 맞는 사용자가 없습니다."
          error={list.error}
          loading={list.loading && !list.data}
          onRetry={list.reload}
        />
        {list.data ? (
          <nav aria-label="페이지" className="v2-pager">
            <span className="v2-muted">
              전체 {formatNumber(list.data.total)}명 · {query.page} / {pages} 페이지
            </span>
            <button disabled={query.page <= 1} onClick={() => setQuery(previous => ({ ...previous, page: previous.page - 1 }))} type="button">
              이전
            </button>
            <button disabled={query.page >= pages} onClick={() => setQuery(previous => ({ ...previous, page: previous.page + 1 }))} type="button">
              다음
            </button>
          </nav>
        ) : null}
      </Panel>
      <UserHistory userId={selectedId} />
    </div>
  );
}

/** The bottom half: the selected person's links saved per day (or month) since sign-up; a running total as the second mode. */
function UserHistory({ userId }: { readonly userId: number | null }) {
  const [granularity, setGranularity] = useState<'day' | 'month'>('day');
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily');
  const history = useAdminResource<UserLinkHistory>(userId ? v2Paths.userHistory(userId, granularity) : null, 60_000);
  const data = history.data && history.data.userId === userId ? history.data : null;
  const labels = useMemo(() => data?.buckets.map(bucket => bucket.start) ?? [], [data]);
  const values = useMemo(() => data?.buckets.map(bucket => (mode === 'daily' ? bucket.saved : bucket.cumulativeSaved)) ?? [], [data, mode]);
  const monthly = data?.granularity === 'month';

  if (!userId) {
    return (
      <Panel className="v2-users-chart">
        <p className="v2-state v2-placeholder">사용자를 선택하면 링크 저장 추이가 표시됩니다.</p>
      </Panel>
    );
  }

  return (
    <Panel
      actions={
        <>
          <Segmented label="단위" onChange={setGranularity} options={[{ value: 'day', label: '일별' }, { value: 'month', label: '월별' }]} value={granularity} />
          <Segmented label="표시" onChange={setMode} options={[{ value: 'daily', label: '신규 저장' }, { value: 'cumulative', label: '누적' }]} value={mode} />
        </>
      }
      className="v2-users-chart"
      title={data ? (
        <span className="v2-user-heading">
          <span className="ltr">{atJupleId(data.jupleId)}</span>
          {data.displayName ? <span>{data.displayName}</span> : null}
        </span>
      ) : '링크 저장 추이'}
    >
      {data ? (
        <>
          <dl className="v2-facts">
            <div><dt>가입일</dt><dd>{formatDay(data.signupDate, true)}</dd></div>
            <div><dt>현재 저장 링크</dt><dd>{formatNumber(data.liveLinks)}개</dd></div>
            <div><dt>가입 후 저장</dt><dd>{formatNumber(data.savedSinceSignup)}개</dd></div>
            <div><dt>상세</dt><dd><Link href={`/users/${data.userId}`}>사용자 상세</Link></dd></div>
          </dl>
          {granularity === 'day' && monthly ? <p className="v2-footnote">가입 후 기간이 길어 월별로 표시합니다.</p> : null}
          <Chart
            axisLabel={label => (monthly ? `${Number(label.slice(5, 7))}월` : shortAxisDay(label))}
            compact
            dataLabel={monthly ? '월별 값 보기' : '날짜별 값 보기'}
            formatLabel={label => (monthly ? formatMonth(label) : formatDay(label, true))}
            formatValue={value => `${formatNumber(value)}개`}
            fromZero={mode === 'daily'}
            kind={mode === 'daily' ? 'bar' : 'line'}
            labels={labels}
            title={mode === 'daily' ? '날짜별 신규 저장 링크' : '가입 후 누적 저장 링크'}
            values={values}
          />
          <p className="v2-footnote">
            {mode === 'daily' ? '그날 저장한 링크 수입니다 (나중에 휴지통으로 옮긴 링크 포함, 영구 삭제된 링크 제외).' : '가입 후 저장한 링크의 누적 수입니다. 현재 보유 링크 수(휴지통 제외)와는 다른 값입니다.'}
            {' '}날짜는 한국 시간 기준입니다.
          </p>
        </>
      ) : null}
      <LoadState error={history.error} loading={history.loading && !data} lines={5} onRetry={history.reload} />
    </Panel>
  );
}
