'use client';

import { useState } from 'react';
import { adminPaths, formatCount, formatInstant, localTodayStartUtc, type DashboardSummary } from '../../lib/adminModel';
import { strings } from '../../lib/strings';
import { PageState, useAdminQuery } from './AdminRoot';

/** 대시보드: one summary call; every number is a live SQL aggregate from the API (nothing estimated, nothing cached here). */
export default function DashboardPage() {
  const [todayStartUtc] = useState(() => localTodayStartUtc(new Date()));
  const { data, error, loading, reload } = useAdminQuery<DashboardSummary>(adminPaths.dashboard(todayStartUtc));

  const metrics: readonly [string, keyof DashboardSummary][] = [
    [strings.metricTotalUsers, 'totalUsers'],
    [strings.metricNewUsersToday, 'newUsersToday'],
    [strings.metricNewUsersLast7Days, 'newUsersLast7Days'],
    [strings.metricTotalLinks, 'totalLinks'],
    [strings.metricLinksSavedToday, 'linksSavedToday'],
    [strings.metricTotalCollections, 'totalCollections'],
    [strings.metricSharedCollections, 'sharedCollections'],
    [strings.metricOpenInquiries, 'openInquiries'],
  ];

  return (
    <>
      <header className="page-header">
        <h1>{strings.dashboardTitle}</h1>
        <button onClick={reload} type="button">
          {strings.retry}
        </button>
      </header>
      <PageState error={error} loading={loading && !data} onRetry={reload} />
      {data ? (
        <>
          <section className="cards">
            {metrics.map(([label, key]) => (
              <div className="card" key={key}>
                <div className="card-label">{label}</div>
                <div className="card-value">{formatCount(data[key] as number)}</div>
              </div>
            ))}
          </section>
          <p className="muted">
            {strings.dashboardTodayNote} ({formatInstant(data.todayStartUtc)}) · {strings.dashboardGeneratedAt} {formatInstant(data.generatedAtUtc)}
          </p>
        </>
      ) : null}
    </>
  );
}
