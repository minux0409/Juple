'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { failureMessage } from '../../../lib/adminModel';
import {
  costCurrencies,
  currentUtcMonth,
  formatMoney,
  formatMonth,
  formatSeoulInstant,
  monthlyValues,
  serviceTotals,
  v2Paths,
  type AzureReport,
  type CostHistory,
} from '../../../lib/adminV2';
import { useAdmin } from '../AdminRoot';
import { Chart } from '../v2/Chart';
import { WalletIcon } from '../v2/Icons';
import { LoadState, PageTitle, Panel, Segmented } from '../v2/ui';
import { useAdminResource } from '../v2/useAdminResource';

interface ExpenseConfiguration {
  readonly enabled: boolean;
  readonly azureSyncEnabled: boolean;
  readonly azureScopes: readonly { readonly scope: string; readonly environment: string }[];
}

interface Revenue {
  readonly billingProgramEnabled: boolean;
  readonly amountsAvailable: boolean;
  readonly explanation: string;
  readonly currentPurchaseStates: readonly { readonly platform: string; readonly state: string; readonly purchases: number }[];
}

/** Monthly Azure report per (scope, month), kept for this tab: going back to a month is instant, and a month is read once. */
const reports = new Map<string, Promise<AzureReport>>();

function useAzureReport(scope: string | null, month: string | null) {
  const { api, reportFailure } = useAdmin();
  const [state, setState] = useState<{ readonly key: string; readonly report: AzureReport | null; readonly error: string | null } | null>(null);
  const key = scope && month ? `${scope}|${month}` : null;
  useEffect(() => {
    if (!key || !scope || !month) {
      return;
    }
    let cancelled = false;
    let request = reports.get(key);
    if (!request) {
      request = api<AzureReport>({ method: 'POST', path: v2Paths.azureReport, body: { scope, month } });
      reports.set(key, request);
      request.catch(() => reports.delete(key));
    }
    request.then(
      report => !cancelled && setState({ key, report, error: null }),
      (error: unknown) => {
        if (!cancelled) {
          reportFailure(error);
          setState({ key, report: null, error: failureMessage(error) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, reportFailure, key, scope, month]);
  const current = state?.key === key ? state : null;
  return { report: current?.report ?? null, error: current?.error ?? null, loading: key !== null && current === null };
}

/**
 * 비용 및 수익: this month's server (Azure) cost, the monthly history and one month's services - all from the imported Azure
 * Cost Management usage (the existing ledger), in the original currency. Revenue is shown only as what is connected: nothing is
 * estimated, and "not connected" is never shown as zero.
 */
export default function CostsPage() {
  const config = useAdminResource<ExpenseConfiguration>(v2Paths.expenseConfiguration, 300_000);
  const scope = config.data?.enabled ? config.data.azureScopes[0]?.scope ?? null : null;
  const [months, setMonths] = useState<'6' | '12' | 'all'>('6');
  const history = useAdminResource<CostHistory>(scope ? v2Paths.costHistory(months) : null, 120_000);
  const thisMonth = currentUtcMonth();
  const current = useAzureReport(scope, thisMonth);
  const [selectedMonth, setSelectedMonth] = useState<string>(thisMonth);
  const detail = useAzureReport(scope, selectedMonth);
  const currencies = useMemo(() => (history.data ? costCurrencies(history.data) : []), [history.data]);
  const [currency, setCurrency] = useState<string | null>(null);
  const shownCurrency = currency && currencies.includes(currency) ? currency : currencies[0] ?? null;
  const labels = useMemo(() => history.data?.months.map(month => month.month) ?? [], [history.data]);
  const values = useMemo(() => (history.data && shownCurrency ? monthlyValues(history.data, shownCurrency) : []), [history.data, shownCurrency]);
  const services = useMemo(() => (detail.report ? serviceTotals(detail.report) : []), [detail.report]);
  const revenue = useAdminResource<Revenue>(v2Paths.revenue, 300_000);

  return (
    <>
      <PageTitle
        actions={<Link href="/expenses">비용 원장 (수동·반복 비용, 증빙)</Link>}
        description="서버 비용은 Azure Cost Management에서 가져온 사용량 비용(세전)입니다. 청구서 확정액과 다를 수 있으며 통화는 변환하지 않습니다."
        eyebrow="비용 및 수익"
        title="비용 및 수익"
      />

      {config.data && !config.data.enabled ? <p className="v2-callout">비용 관리가 비활성화되어 있습니다. 서버 비용을 0으로 간주하지 않습니다.</p> : null}
      {config.data?.enabled && !scope ? <p className="v2-callout">Azure 비용 범위가 설정되지 않았습니다.</p> : null}
      <LoadState error={config.error} loading={config.loading && !config.data} onRetry={config.reload} />

      {scope ? (
        <>
          <section className="v2-cost-hero">
            <div className="v2-kpi v2-kpi-static" aria-live="polite">
              <span className="v2-kpi-head">
                <span className="v2-kpi-icon"><WalletIcon size={18} /></span>
                <span className="v2-kpi-label">이번 달 서버 비용</span>
              </span>
              {current.report ? (
                current.report.totals.length && current.report.totals.some(total => total.current !== null) ? (
                  current.report.totals.map(total => (
                    <span className="v2-kpi-value" key={total.currency}>{total.current === null ? '미동기화' : formatMoney(total.current, total.currency)}</span>
                  ))
                ) : (
                  <span className="v2-kpi-value v2-kpi-unknown">{current.report.syncStatus === 'Never' ? '아직 동기화 안 됨' : '미집계'}</span>
                )
              ) : (
                <span className="v2-kpi-value"><span className="v2-kpi-placeholder" /></span>
              )}
              {current.report ? (
                <span className="v2-kpi-meta">
                  {formatMonth(current.report.month)} 1일 ~ {current.report.through.slice(8, 10)}일 (UTC 사용일) · 추정 사용량 비용 · 마지막 동기화 {formatSeoulInstant(current.report.lastSyncAtUtc)}
                  {current.report.syncStatus === 'Failed' ? <> · <strong className="v2-text-danger">최근 동기화 실패 ({current.report.failureCode ?? '원인 미상'})</strong></> : null}
                </span>
              ) : null}
            </div>
            <LoadState error={current.error} loading={false} />
          </section>

          <Panel
            actions={
              <>
                {currencies.length > 1 && shownCurrency ? (
                  <Segmented label="통화" onChange={setCurrency} options={currencies.map(code => ({ value: code, label: code }))} value={shownCurrency} />
                ) : null}
                <Segmented label="기간" onChange={setMonths} options={[{ value: '6', label: '6개월' }, { value: '12', label: '12개월' }, { value: 'all', label: '전체' }]} value={months} />
              </>
            }
            title="월별 서버 비용"
          >
            {history.data && shownCurrency ? (
              <>
                <Chart
                  axisLabel={label => `${Number(label.slice(5, 7))}월`}
                  dataLabel="월별 값 보기"
                  formatLabel={label => `${formatMonth(label)}${label === thisMonth ? ' (진행 중)' : ''}`}
                  formatValue={value => formatMoney(value, shownCurrency)}
                  kind="bar"
                  labels={labels}
                  title={`월별 서버 비용 (${shownCurrency})`}
                  unmeasuredText="미동기화"
                  values={values}
                />
                <div aria-label="월 선택" className="v2-month-chips" role="radiogroup">
                  {history.data.months.map(month => (
                    <button aria-checked={month.month === selectedMonth} key={month.month} onClick={() => setSelectedMonth(month.month)} role="radio" type="button">
                      {formatMonth(month.month)}
                      <small>{month.isCurrent ? '진행 중' : month.synced ? '동기화됨' : '미동기화'}</small>
                    </button>
                  ))}
                </div>
                <p className="v2-footnote">진행 중인 달은 사용량이 계속 반영됩니다. 지난 달도 Azure가 며칠간 보정할 수 있으며, 실제 청구서 금액은 비용 원장에서 대사합니다.</p>
              </>
            ) : history.data ? (
              <p className="v2-state">가져온 서버 비용이 아직 없습니다.</p>
            ) : null}
            <LoadState error={history.error} loading={history.loading && !history.data} lines={5} onRetry={history.reload} />
          </Panel>

          <Panel title={`서비스별 상세 비용 · ${formatMonth(selectedMonth)}`}>
            {detail.report ? (
              services.length ? (
                <div className="v2-table-scroll">
                  <table className="v2-table">
                    <thead>
                      <tr>
                        <th scope="col">Azure 서비스</th>
                        <th className="num" scope="col">금액</th>
                        <th scope="col">통화</th>
                        <th scope="col">기간 (UTC 사용일)</th>
                        <th scope="col">비용 기준</th>
                      </tr>
                    </thead>
                    <tbody>
                      {services.map(service => (
                        <tr key={`${service.service}-${service.currency}`}>
                          <td>{service.service}</td>
                          <td className="num">{formatMoney(service.amount, service.currency)}</td>
                          <td>{service.currency}</td>
                          <td>
                            {detail.report!.month.slice(0, 7)}-01 ~ {detail.report!.through} · {service.days}일
                          </td>
                          <td>Azure 사용량 (세전, 추정)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="v2-state">{detail.report.lastSyncAtUtc ? '이 달에 가져온 서버 비용 내역이 없습니다.' : '이 달은 아직 동기화되지 않았습니다.'}</p>
              )
            ) : null}
            <p className="v2-footnote">리소스 그룹: <span className="ltr">{scope.split('/').pop()}</span> · 서비스 이름은 Azure가 보고한 그대로이며, 확인되지 않은 비용 배분은 계산하지 않습니다.</p>
            <LoadState error={detail.error} loading={detail.loading} lines={4} />
          </Panel>
        </>
      ) : null}

      <Panel title="수익 현황">
        <div className="v2-revenue">
          <p className="v2-kpi-value v2-kpi-unknown">데이터 미연동</p>
          <p>
            {revenue.data?.explanation ?? '결제·정산 데이터가 아직 연결되지 않았습니다.'} 실제 매출이 연결되기 전에는 0원으로 표시하지 않습니다.
          </p>
          <ul className="v2-planned">
            <li><strong>Apple App Store</strong> — 판매·정산 보고서 연동 예정</li>
            <li><strong>Google Play</strong> — 구독 거래·정산 보고서 연동 예정</li>
            <li><strong>기타 결제</strong> — 실제 결제 수단 확정 후</li>
          </ul>
          <p className="v2-footnote">연동 후 표시할 항목: 이번 달 매출, 월별 매출 추이, 플랫폼별 매출, 환불, 수수료, 정산액. 매출(거래 금액)과 정산액(수수료·세금 공제 후 지급액)은 따로 표시하며, 플랫폼별 정산 주기와 통화를 그대로 유지합니다.</p>
          {revenue.data?.currentPurchaseStates.length ? (
            <p className="v2-footnote">
              참고: 현재 구매 상태 {revenue.data.currentPurchaseStates.map(state => `${state.platform} ${state.state} ${state.purchases}건`).join(', ')} (거래별 금액 아님)
            </p>
          ) : null}
          {revenue.error ? <p className="v2-footnote">구매 상태 조회 불가: {revenue.error}</p> : null}
          <Link href="/revenue">매출 및 손익 상세 (기존 화면)</Link>
        </div>
      </Panel>
    </>
  );
}
