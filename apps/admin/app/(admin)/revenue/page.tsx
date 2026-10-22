'use client';
import { useAdminQuery } from '../AdminRoot';
import { BarChart } from '../analytics/AnalyticsParts';
import { PeriodPicker, useWorkspaceDates } from '../workspace/WorkspaceDates';
import { WorkspaceSkeleton } from '../workspace/WorkspacePage';
import { periodQuery, workspaceBase, type WorkspaceRevenue } from '../../../lib/workspace';
import { expenseBase, money, type ExpenseConfig, type Summary } from '../../../lib/expenses';

export default function RevenuePage() {
  const { period } = useWorkspaceDates();
  const revenue = useAdminQuery<WorkspaceRevenue>(`${workspaceBase}/revenue`);
  const config = useAdminQuery<ExpenseConfig>(`${expenseBase}/configuration`);
  const costs = useAdminQuery<Summary>(config.data?.enabled ? `${expenseBase}/summary?${periodQuery(period)}` : null);
  return <><header className="page-header"><h1>Revenue & Profit · 매출 및 손익</h1><button onClick={() => { revenue.reload(); costs.reload(); }}>새로고침</button></header><PeriodPicker />
    {revenue.loading || config.loading ? <WorkspaceSkeleton /> : null}
    {revenue.error ? <p role="alert">{revenue.error}</p> : null}
    {revenue.data ? <><section className="card"><h2>매출·정산 데이터 범위</h2><p>{revenue.data.explanation}</p><p>Billing 프로그램: {revenue.data.billingProgramEnabled ? '운영 중' : 'OFF — 이번 화면에서 변경하지 않음'}</p><dl className="metric-list"><div><dt>실제 매출</dt><dd>자료 미연결</dd></div><div><dt>정산액·수수료</dt><dd>자료 미연결</dd></div><div><dt>순손익</dt><dd>매출 미확인으로 계산 불가</dd></div></dl></section>
      <section className="card"><h2>현재 구매 상태 (거래별 매출 아님)</h2>{revenue.data.currentPurchaseStates.length ? <table><thead><tr><th>플랫폼</th><th>최신 상태</th><th>구매 객체</th></tr></thead><tbody>{revenue.data.currentPurchaseStates.map(x => <tr key={`${x.platform}-${x.state}`}><td>{x.platform}</td><td>{x.state}</td><td>{x.purchases}</td></tr>)}</tbody></table> : <p>현재 보관된 구매 객체가 없습니다.</p>}<p className="muted">선택 기간의 신규·갱신·환불 거래 건수와 다릅니다. 취소·환불 금액을 최신 상태만으로 역산하지 않습니다.</p></section></> : null}
    {costs.error || config.error ? <p role="alert">{costs.error ?? config.error}</p> : null}
    {config.data && !config.data.enabled ? <p className="notice">비용 원장이 비활성화되어 있습니다. 비용을 0으로 간주하지 않습니다.</p> : null}
    {costs.data ? <><h2>기간 내 확정 지출 · 통화별</h2><div className="workspace-grid">{costs.data.totals.filter(x => x.status === 'Paid').map(x => <article className="card" key={x.currency}><h3>{x.currency}</h3><strong>{money(x.gross, x.currency)}</strong><p>환불/조정 포함 · 다른 통화와 합산하지 않음</p></article>)}</div><div className="workspace-grid">{[...new Set(costs.data.months.map(x => x.currency))].map(currency => { const values = costs.data!.months.filter(x => x.currency === currency && x.status === 'Paid').sort((a, b) => a.label.localeCompare(b.label)); return <BarChart key={currency} title={`월별 확정 비용 (${currency})`} unit={currency} days={values.map(x => x.label)} values={values.map(x => Number(x.gross))} />; })}</div><p className="muted">실제 매출·정산 원장 연결 전에는 비용만 표시합니다. 예상 매출을 확정 지출과 상계하지 않습니다.</p></> : null}
  </>;
}
