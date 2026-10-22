'use client';
import Link from 'next/link';
import { useAdminQuery } from '../AdminRoot';
import { BarChart, Kpis } from '../analytics/AnalyticsParts';
import { PeriodPicker, useWorkspaceDates } from './WorkspaceDates';
import { periodQuery, workspaceBase, type WorkspaceOverview, type WorkspaceOperations } from '../../../lib/workspace';

export function WorkspaceSkeleton() { return <div className="workspace-grid" aria-label="불러오는 중" role="status">{[1, 2, 3, 4].map(n => <div className="card skeleton" key={n}>데이터를 불러오는 중입니다.</div>)}</div>; }
export function WorkspacePage({ section = 'overview' }: { section?: 'overview' | 'users' | 'links' }) {
  const { period } = useWorkspaceDates();
  const { data, loading, error, reload } = useAdminQuery<WorkspaceOverview>(`${workspaceBase}/overview?${periodQuery(period)}`);
  const title = { overview: 'Overview · 서비스 현황', users: 'Users · 가입 및 활동', links: 'Links · 저장 및 협업' }[section];
  const labels = data?.series.map(x => x.date) ?? [];
  return <>
    <header className="page-header"><div><p className="eyebrow">JUPLE WORKSPACE</p><h1>{title}</h1></div><button onClick={reload}>새로고침</button></header>
    <PeriodPicker />
    {loading ? <WorkspaceSkeleton /> : null}
    {error ? <section className="card" role="alert"><h2>통계 데이터를 불러오지 못했습니다.</h2><p>{error}</p><p>새 통계 API와 Migration이 배포·활성화돼 있는지 확인하세요. 기존 기능은 <Link href="/analytics">UTC 분석</Link>과 <Link href="/users">사용자 목록</Link>에서 사용할 수 있습니다.</p><button onClick={reload}>다시 시도</button></section> : null}
    {data ? <>
      <Kpis items={[["현재 가입자", data.totalUsers], ["기간 신규 가입", data.newUsers], ["현재 보유 링크", data.liveLinks], ["기간 저장", data.savedLinks], ["기간 활동 사용자", data.activeUsers ?? '수집 전'], ["현재 컬렉션",data.currentCollections],["현재 공유 컬렉션",data.sharedCollections],["미처리 문의",data.openInquiries]]} />
      <div className="workspace-grid">
        {section !== 'links' ? <>
          <BarChart title="날짜별 신규 가입" unit="명" days={labels} values={data.series.map(x => x.signups)} />
          <BarChart title="현재 남아있는 계정의 누적 가입 추이" unit="명" days={labels} values={data.series.map(x => x.survivingAccountsToDate)} />
          <BarChart title="날짜별 활동 사용자" unit="명" days={labels} values={data.series.map(x => x.activeUsers)} />
          <section className="card"><h2>플랫폼별 활동</h2><p className="muted">가입 플랫폼 아님 · 여러 플랫폼 사용자는 각각 포함 · 합계는 고유 사용자 수와 다릅니다.</p><dl className="metric-list">{data.platforms.map(x => <div key={x.platform}><dt>{x.platform}</dt><dd>{data.activityTrackingSince ? `${x.activeUsers}명` : '미수집'}</dd></div>)}</dl><p>종료일 기준 DAU {data.dau ?? '—'} / WAU {data.wau ?? '—'} / MAU {data.mau ?? '—'}</p></section>
        </> : null}
        {section !== 'users' ? <>
          <BarChart title="날짜별 신규 저장 링크" unit="개" days={labels} values={data.series.map(x => x.linksSaved)} />
          <BarChart title="날짜별 저장 사용자" unit="명" days={labels} values={data.series.map(x => x.linkSavers)} />
          <BarChart title="현재 남아있는 링크의 누적 저장 추이" unit="개" days={labels} values={data.series.map(x => x.survivingSavedLinksToDate)} />
          <BarChart title="컬렉션 생성" unit="개" days={labels} values={data.series.map(x => x.collectionsCreated)} />
          {section === 'links' ? <>
            <BarChart title="공유 컬렉션 링크 추가 알림 이벤트" unit="개" days={labels} values={data.series.map(x=>x.sharedLinkAddEvents)} />
            <BarChart title="공개 링크 공유 알림 이벤트" unit="개" days={labels} values={data.series.map(x=>x.shareEvents)} />
            <BarChart title="댓글 알림 이벤트" unit="개" days={labels} values={data.series.map(x=>x.commentEvents)} />
          </> : null}
          <section className="card"><h2>도메인별 저장</h2>{data.domains.length ? <dl className="metric-list">{data.domains.map(x => <div key={x.domain}><dt>{x.domain}</dt><dd>{x.links}개</dd></div>)}</dl> : <p>선택한 기간의 저장 링크가 없습니다.</p>}<p>저장 사용자당 평균 {data.uniqueSavers ? (data.savedLinks / data.uniqueSavers).toFixed(2) : '—'}개 · 고유 저장 사용자 {data.uniqueSavers}명</p></section>
        </> : null}
        {section === 'users' ? <section className="card"><h2>최근 활동 사용자</h2>{data.recentUsers.length ? <ul>{data.recentUsers.map(x => <li key={x.jupleId}>@{x.jupleId} · {new Date(x.lastSeenAtUtc).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</li>)}</ul> : <p>선택 기간에 기록된 활동이 없습니다.</p>}<Link href="/users">사용자 계정 목록 열기</Link></section> : null}
      </div>
      <details className="card"><summary>집계 기준 및 데이터 범위</summary>{data.coverage.map(x => <p key={x.metric}><strong>{x.available ? '제공' : '제한'}:</strong> {x.explanation}</p>)}<p>KST 수집 시작: {data.activityTrackingSince ?? '수집 전'} · 생성 시각 {new Date(data.generatedAtUtc).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p></details>
    </> : null}
  </>;
}

export function OperationsPage() {
  const { period } = useWorkspaceDates();
  const { data, error, loading, reload } = useAdminQuery<WorkspaceOperations>(`${workspaceBase}/operations?${periodQuery(period)}`);
  const dates = [...new Set(data?.push.map(x => x.date) ?? [])];
  return <><header className="page-header"><h1>Operations · 알림 및 운영</h1><button onClick={reload}>새로고침</button></header><PeriodPicker />
    {loading ? <WorkspaceSkeleton /> : null}{error ? <p role="alert">{error} · 운영 API 활성화 상태를 확인하세요.</p> : null}
    {data ? <><div className="workspace-grid">{['Android', 'Ios'].flatMap(platform => ['Sent', 'Failed', 'Sending'].map(status => <BarChart key={`${platform}-${status}`} title={`${platform === 'Android' ? 'Android FCM' : 'iOS APNs'} · ${status}`} unit="개" days={dates} values={dates.map(date => data.push.find(x => x.date === date && x.platform === platform && x.status === status)?.deliveries ?? 0)} />))}</div>
      <section className="card"><h2>생성~마지막 발송 시도 지연</h2><div className="table-scroll"><table><thead><tr><th>날짜(KST)</th><th>플랫폼</th><th>상태</th><th>건수</th><th>평균 초</th></tr></thead><tbody>{data.push.filter(x => x.deliveries > 0).map(x => <tr key={`${x.date}-${x.platform}-${x.status}`}><td>{x.date}</td><td>{x.platform}</td><td>{x.status}</td><td>{x.deliveries}</td><td>{x.averageCreationToAttemptMs === null ? '미확인' : (x.averageCreationToAttemptMs / 1000).toFixed(2)}</td></tr>)}</tbody></table></div>{!data.push.some(x => x.deliveries > 0) ? <p>보관 중인 발송 기록이 없습니다.</p> : null}</section>
      <section className="card"><h2>최근 알림 처리 이벤트</h2>{data.events.length ? <ul>{data.events.map((x, i) => <li key={i}>{new Date(x.atUtc).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · {x.kind} · {x.status} · 시도 {x.attempts}</li>)}</ul> : <p>선택 기간의 이벤트가 없습니다.</p>}</section>
      {data.telemetry?.available ? <BarChart title="API 5xx (Azure Monitor)" unit="개" days={data.telemetry.days.map(x => x.date)} values={data.telemetry.days.map(x => x.errors5xx)} /> : <p className="notice">Azure Monitor: {data.telemetry?.status ?? '연동 전'} · 데이터가 없으면 오류 0건으로 표시하지 않습니다.</p>}
      <section className="card"><h2>집계 기준</h2>{data.coverage.map(x => <p key={x.metric}>{x.explanation}</p>)}</section></> : null}
  </>;
}
