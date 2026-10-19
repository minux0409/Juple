'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { displayJupleId, formatInstant } from '../../../../lib/adminModel';
import { ANALYTICS_RANGES, parseRange, userLinkStatsPath, type AnalyticsRange, type UserLinkStats } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { PageState, useAdminQuery } from '../../AdminRoot';
import { BarChart, Kpis } from '../../analytics/AnalyticsParts';

const RANGE_LABELS: Readonly<Record<AnalyticsRange, string>> = {
  '7d': strings.analyticsRange7,
  '30d': strings.analyticsRange30,
  '90d': strings.analyticsRange90,
};

function parseId(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[1-9][0-9]{0,17}$/.test(text) ? Number(text) : null;
}

/**
 * One person's link activity: how many links they hold now (trash excluded) and how many they saved today / in the last 7, 30 and 90
 * UTC days, with a per-day chart for the chosen range (kept in the URL, ?range=). Counts only - the API never sends a link's URL,
 * title, memo or image, and nothing here asks for them.
 */
export default function UserLinkStatsPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <UserLinkStatsView />
    </Suspense>
  );
}

function UserLinkStatsView() {
  const id = parseId(useParams<{ userId: string }>().userId);
  const router = useRouter();
  const pathname = usePathname();
  const range = parseRange(useSearchParams().get('range'));
  const { data, error, loading, reload } = useAdminQuery<UserLinkStats>(id ? userLinkStatsPath(id, range) : null);

  if (!id) {
    return <p className="state">{strings.notFound}</p>;
  }

  return (
    <>
      <p>
        <Link href="/users">{strings.userDetailBack}</Link>
      </p>
      <header className="page-header">
        <h1>{strings.userDetailTitle}</h1>
        <div className="tabs" role="tablist" aria-label={strings.userDetailTitle}>
          {ANALYTICS_RANGES.map(option => (
            <button aria-selected={option.range === range} key={option.range} onClick={() => router.replace(`${pathname}?range=${option.range}`)} role="tab" type="button">
              {RANGE_LABELS[option.range]}
            </button>
          ))}
        </div>
      </header>
      <PageState error={error} loading={loading && !data} onRetry={reload} />
      {data ? (
        <>
          <p>
            <span className="ltr">{displayJupleId(data.jupleId)}</span> · {strings.userDetailCreatedAt} {formatInstant(data.createdAtUtc)}
          </p>
          <Kpis
            items={[
              [strings.userDetailLive, data.liveLinks],
              [strings.userDetailToday, data.savedToday],
              [strings.userDetailSaved7, data.saved7Days],
              [strings.userDetailSaved30, data.saved30Days],
              [strings.userDetailSaved90, data.saved90Days],
              [`${strings.userDetailInRange} (${RANGE_LABELS[range]})`, data.savedInRange],
            ]}
          />
          <p className="muted">{strings.userDetailNote}</p>
          <BarChart days={data.series.map(day => day.date)} title={`${strings.userDetailChart} · ${RANGE_LABELS[range]}`} unit="개" values={data.series.map(day => day.linksSaved)} />
          <p className="muted">
            {strings.analyticsUtcNote} · {strings.dashboardGeneratedAt} {formatInstant(data.generatedAtUtc)}
          </p>
        </>
      ) : null}
    </>
  );
}
