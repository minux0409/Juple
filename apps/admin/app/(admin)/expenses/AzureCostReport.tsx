'use client';
import { useState } from 'react';
import { useAdmin } from '../AdminRoot';
import { expenseBase, money } from '../../../lib/expenses';
import { failureMessage } from '../../../lib/adminModel';

type Point = { date: string; label: string; currency: string; amount: number };
type Detail = { status: string; points: Point[] };
interface Report {
  month: string; through: string; lastSyncAtUtc: string | null; syncStatus: string; failureCode: string | null;
  totals: { currency: string; current: number | null; previousSameDays: number | null; previousFullMonth: number | null; changePercent: number | null }[];
  services: Point[]; resources: Detail; forecast: Detail;
}
function groups(points: Point[]) {
  const result = new Map<string, Point>();
  for (const point of points) { const key = `${point.currency}:${point.label}`; result.set(key, { ...point, amount: point.amount + (result.get(key)?.amount ?? 0) }); }
  return [...result.values()].sort((a,b) => b.amount-a.amount);
}
export function AzureCostReport({ scope, month, insightsEnabled }: { scope: string; month: string; insightsEnabled: boolean }) {
  const { api, reportFailure } = useAdmin();
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return <section className="azure-report">
    <button disabled={busy || !scope || !month} onClick={async () => {
      setBusy(true); setError(null);
      try { setData(await api<Report>({ path: `${expenseBase}/azure-report`, method: 'POST', body: { scope, month: `${month}-01`, includeDetails: insightsEnabled } })); }
      catch (e) { reportFailure(e); setError(failureMessage(e)); }
      finally { setBusy(false); }
    }}>{busy ? '조회 중…' : '선택 월 Azure 분석 조회'}</button>
    <p className="muted">원장과 별도인 Azure 사용량 분석입니다. 일자는 Azure UsageDate(UTC 청구일)이며 KST 요청 시간으로 재구성하지 않습니다. 당월은 현재까지, 전월은 동일 일수와 전체 월을 구분합니다. 대사한 사용량을 다시 원장 합계에 더하지 않습니다.</p>
    {error ? <p role="alert">{error}</p> : null}
    {data ? <>
      <p>기준: {data.month} ~ {data.through} · 동기화 {data.syncStatus} · 마지막 성공 {data.lastSyncAtUtc ? new Date(data.lastSyncAtUtc).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미수집'} {data.failureCode ?? ''}</p>
      {!data.totals.length ? <p>저장된 비용 스냅샷이 없습니다. 사용량 0원으로 간주하지 않습니다.</p> : <div className="table-scroll"><table><thead><tr><th>통화</th><th>선택 월 누적</th><th>전월 같은 일수</th><th>증감</th><th>전월 전체</th></tr></thead><tbody>{data.totals.map(x => <tr key={x.currency}><td>{x.currency}</td><td>{x.current === null ? '미수집' : money(x.current,x.currency)}</td><td>{x.previousSameDays === null ? '미수집' : money(x.previousSameDays,x.currency)}</td><td>{x.changePercent === null ? '비교 불가' : `${x.changePercent.toFixed(1)}%`}</td><td>{x.previousFullMonth === null ? '미수집' : money(x.previousFullMonth,x.currency)}</td></tr>)}</tbody></table></div>}
      <div className="workspace-grid"><section><h3>선택 월 서비스별 사용량</h3><dl className="metric-list">{groups(data.services).map(x => <div key={`${x.currency}:${x.label}`}><dt>{x.label}</dt><dd>{money(x.amount,x.currency)}</dd></div>)}</dl>{!data.services.length ? <p>스냅샷 없음</p> : null}</section>
        <section><h3>리소스별 사용량 · 상위 20</h3>{data.resources.status === 'available' ? <dl className="metric-list">{groups(data.resources.points).slice(0,20).map(x => <div key={`${x.currency}:${x.label}`}><dt>{x.label}</dt><dd>{money(x.amount,x.currency)}</dd></div>)}</dl> : <p>조회 불가: {data.resources.status}</p>}</section>
        <section><h3>Azure 월말 전망</h3>{data.forecast.status === 'available' ? <dl className="metric-list">{groups(data.forecast.points.map(x=>({...x,label:'전체 전망'}))).map(x => <div key={x.currency}><dt>{x.currency}</dt><dd>{money(x.amount,x.currency)}</dd></div>)}</dl> : <p>전망 미제공: {data.forecast.status}</p>}<p className="muted">Azure ActualCost 전망 응답(실제 사용량 포함)의 합계. 확정 청구·카드 결제·원장 지출이 아니며 현재 누적액을 다시 더하지 않습니다. 원장에 저장하지 않습니다.</p></section>
      </div>
    </> : null}
    {!insightsEnabled ? <p className="muted">리소스·전망 직접 조회는 미설정입니다. 서버의 명시적 활성화와 선택 Scope의 Cost Management Reader 권한 검증이 필요합니다.</p> : <p className="muted">직접 조회는 사용자 요청 시 실행하고 10분간 재사용합니다. 데이터 지연·크레딧·할인 반영 범위를 확인하고, 세금과 최종 카드 청구는 청구서로 대사하세요.</p>}
  </section>;
}
