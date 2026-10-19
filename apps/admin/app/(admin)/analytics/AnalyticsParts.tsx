'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ANALYTICS_RANGES,
  analyticsPath,
  labelIndexes,
  layoutBars,
  parseRange,
  shortDay,
  trackingCoverage,
  type AnalyticsOverview,
  type AnalyticsRange,
} from '../../../lib/analytics';
import { formatCount, formatInstant } from '../../../lib/adminModel';
import { strings } from '../../../lib/strings';
import { PageState, useAdminQuery } from '../AdminRoot';

const RANGE_LABELS: Readonly<Record<AnalyticsRange, string>> = {
  '7d': strings.analyticsRange7,
  '30d': strings.analyticsRange30,
  '90d': strings.analyticsRange90,
};

/**
 * One analytics page: title, the 7 / 30 / 90 day switch (kept in the URL, ?range=), loading / error, the tracking-start notice and
 * the UTC note around the page's own content. Every analytics page reads the same overview call.
 */
export function AnalyticsFrame({ title, children }: { title: string; children: (data: AnalyticsOverview) => React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const range = parseRange(useSearchParams().get('range'));
  const { data, error, loading, reload } = useAdminQuery<AnalyticsOverview>(analyticsPath(range));
  const coverage = data ? trackingCoverage(data.activityTrackingSince, data.series[0]?.date ?? data.startDateUtc) : null;

  return (
    <>
      <header className="page-header">
        <h1>{title}</h1>
        <div className="tabs" role="tablist" aria-label={strings.analyticsTitle}>
          {ANALYTICS_RANGES.map(option => (
            <button
              aria-selected={option.range === range}
              key={option.range}
              onClick={() => router.replace(`${pathname}?range=${option.range}`)}
              role="tab"
              type="button"
            >
              {RANGE_LABELS[option.range]}
            </button>
          ))}
        </div>
      </header>
      <PageState error={error} loading={loading && !data} onRetry={reload} />
      {data ? (
        <>
          {coverage?.kind === 'none' ? <p className="notice tracking">{strings.analyticsTrackingNone}</p> : null}
          {coverage?.kind === 'partial' ? <p className="notice tracking">{strings.analyticsTrackingPartial.replace('{date}', coverage.since)}</p> : null}
          {children(data)}
          <p className="muted">
            {strings.analyticsUtcNote} · {strings.dashboardGeneratedAt} {formatInstant(data.generatedAtUtc)}
          </p>
        </>
      ) : null}
    </>
  );
}

export function Kpis({ items }: { items: readonly (readonly [string, number | string])[] }) {
  return (
    <section className="cards">
      {items.map(([label, value]) => (
        <div className="card" key={label}>
          <div className="card-label">{label}</div>
          <div className="card-value">{typeof value === 'number' ? formatCount(value) : value}</div>
        </div>
      ))}
    </section>
  );
}

const PLOT_WIDTH = 600;
const PLOT_HEIGHT = 160;
const AXIS_WIDTH = 36;
const LABEL_HEIGHT = 18;

/**
 * A small SVG bar chart (no chart library): scales with its box (viewBox), each bar's <title> is its tooltip, and the figure has a
 * text summary for screen readers. A day without data (null) is drawn as no bar at all - never as a 0.
 */
export function BarChart({ title, days, values }: { title: string; days: readonly string[]; values: readonly (number | null)[] }) {
  const layout = layoutBars(values, days, PLOT_WIDTH, PLOT_HEIGHT);
  const known = values.filter((value): value is number => value !== null);
  const total = known.reduce((sum, value) => sum + value, 0);
  const labelled = new Set(labelIndexes(days.length));
  const summary = known.length > 0 ? `${title}: ${days.length}일, 합계 ${formatCount(total)}, 최대 ${formatCount(Math.max(...known))}` : `${title}: ${strings.chartNoData}`;

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg aria-label={summary} role="img" viewBox={`0 0 ${PLOT_WIDTH + AXIS_WIDTH} ${PLOT_HEIGHT + LABEL_HEIGHT}`}>
        {layout.ticks.map(tick => (
          <g key={tick.value}>
            <line className="chart-grid" x1={AXIS_WIDTH} x2={AXIS_WIDTH + PLOT_WIDTH} y1={tick.y} y2={tick.y} />
            <text className="chart-axis" textAnchor="end" x={AXIS_WIDTH - 4} y={Math.max(10, tick.y + 4)}>
              {formatCount(tick.value)}
            </text>
          </g>
        ))}
        {layout.bars.map((bar, index) =>
          bar.value === null ? null : (
            <rect className="chart-bar" height={Math.max(bar.height, bar.value > 0 ? 1 : 0)} key={bar.label} width={bar.width} x={AXIS_WIDTH + bar.x} y={bar.height === 0 && bar.value > 0 ? PLOT_HEIGHT - 1 : bar.y}>
              <title>{`${days[index]}: ${formatCount(bar.value)}`}</title>
            </rect>
          ),
        )}
        {layout.bars.map((bar, index) =>
          labelled.has(index) ? (
            <text
              className="chart-axis"
              key={`label-${bar.label}`}
              // The first and last labels hug the plot edges so they are never cut off.
              textAnchor={index === 0 && layout.bars.length > 1 ? 'start' : index === layout.bars.length - 1 ? 'end' : 'middle'}
              x={index === 0 && layout.bars.length > 1 ? AXIS_WIDTH + bar.x : index === layout.bars.length - 1 ? AXIS_WIDTH + PLOT_WIDTH : AXIS_WIDTH + bar.x + bar.width / 2}
              y={PLOT_HEIGHT + LABEL_HEIGHT - 4}
            >
              {shortDay(days[index] ?? '')}
            </text>
          ) : null,
        )}
      </svg>
      {known.length === 0 ? <p className="muted">{strings.chartNoData}</p> : null}
    </figure>
  );
}
