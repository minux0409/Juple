'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DASHBOARD_METRICS,
  formatDay,
  formatNumber,
  formatSeoulInstant,
  seoulToday,
  shortAxisDay,
  v2Paths,
  type DashboardKpis,
  type DashboardMetric,
  type MetricSeries,
  type Period,
} from '../../lib/adminV2';
import { Chart } from './v2/Chart';
import { LinkIcon, UserPlusIcon, UsersIcon } from './v2/Icons';
import { LoadState, PageTitle, Panel, PeriodControl } from './v2/ui';
import { useAdminResource } from './v2/useAdminResource';

const KPI_ICONS: Readonly<Record<DashboardMetric, (props: { size?: number }) => React.ReactNode>> = {
  users: UsersIcon,
  links: LinkIcon,
  signups: UserPlusIcon,
};

/**
 * 대시보드: three numbers (전체 사용자 / 전체 저장 링크 / 오늘 신규 가입자) and ONE chart below them - the chart of the selected
 * number. Each chart's last day equals its number (the API computes both with one definition, shown under the chart).
 */
export default function DashboardPage() {
  const [metric, setMetric] = useState<DashboardMetric>('users');
  const [period, setPeriod] = useState<Period>({ range: '30d' });
  const kpis = useAdminResource<DashboardKpis>(v2Paths.kpis, 30_000);
  const series = useAdminResource<MetricSeries>(v2Paths.series(metric, period), 60_000);
  const selected = DASHBOARD_METRICS.find(entry => entry.metric === metric) ?? DASHBOARD_METRICS[0];
  const reloadKpis = kpis.reload;
  const kpiDay = kpis.data?.seoulToday;

  // 오늘 신규 가입자 restarts at Seoul midnight: once the Seoul date moves past the numbers' date, they are read again.
  useEffect(() => {
    if (!kpiDay) {
      return;
    }
    const timer = window.setInterval(() => {
      if (seoulToday() !== kpiDay) {
        reloadKpis();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [kpiDay, reloadKpis]);

  const labels = useMemo(() => series.data?.points.map(point => point.date) ?? [], [series.data]);
  const values = useMemo(() => series.data?.points.map(point => point.value) ?? [], [series.data]);
  const multiYear = labels.length > 0 && labels[0].slice(0, 4) !== labels[labels.length - 1].slice(0, 4);

  return (
    <>
      <PageTitle
        actions={
          <button
            onClick={() => {
              kpis.reload();
              series.reload();
            }}
            type="button"
          >
            새로고침
          </button>
        }
        description={kpis.data ? `${formatSeoulInstant(kpis.data.generatedAtUtc)} 기준 · 한국 시간` : undefined}
        eyebrow="JUPLE ADMIN"
        title="대시보드"
      />

      <div aria-label="핵심 지표" className="v2-kpis" role="group">
        {DASHBOARD_METRICS.map(entry => {
          const Icon = KPI_ICONS[entry.metric];
          const value = kpis.data?.[entry.kpi];
          return (
            <button aria-pressed={entry.metric === metric} className="v2-kpi" key={entry.metric} onClick={() => setMetric(entry.metric)} type="button">
              <span className="v2-kpi-head">
                <span className="v2-kpi-icon"><Icon size={18} /></span>
                <span className="v2-kpi-label">{entry.title}</span>
              </span>
              <span className="v2-kpi-value">
                {value === undefined ? (kpis.error ? '-' : <span className="v2-kpi-placeholder" />) : formatNumber(value)}
                {value !== undefined ? <small>{entry.unit}</small> : null}
              </span>
            </button>
          );
        })}
      </div>
      {kpis.error ? <LoadState error={kpis.error} loading={false} onRetry={kpis.reload} /> : null}

      <Panel actions={<PeriodControl onChange={setPeriod} period={period} />} className="v2-chart-panel" title={selected.chartTitle}>
        {series.data ? (
          <>
            <Chart
              axisLabel={shortAxisDay}
              formatLabel={label => formatDay(label, multiYear)}
              formatValue={value => `${formatNumber(value)}${selected.unit}`}
              fromZero={selected.chart === 'bar'}
              kind={selected.chart}
              labels={labels}
              title={`${selected.chartTitle}, ${formatDay(series.data.from, true)}부터 ${formatDay(series.data.through, true)}까지`}
              values={values}
            />
            <p className="v2-footnote">{series.data.definition}</p>
          </>
        ) : null}
        <LoadState error={series.error} loading={series.loading && !series.data} lines={6} onRetry={series.reload} />
      </Panel>
    </>
  );
}
