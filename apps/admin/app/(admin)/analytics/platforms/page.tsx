'use client';

import { Suspense } from 'react';
import { activeSeries, platformShares, type AnalyticsOverview } from '../../../../lib/analytics';
import { formatCount } from '../../../../lib/adminModel';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame, BarChart, ShareList } from '../AnalyticsParts';

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  Android: strings.platformAndroid,
  Ios: strings.platformIos,
  Web: strings.platformWeb,
  Unknown: strings.platformUnknown,
};

function shareRows(platforms: AnalyticsOverview['platforms']) {
  return [
    { label: strings.platformsTotal, value: platforms.activeUsersInRange, percent: platforms.activeUsersInRange > 0 ? 100 : 0 },
    ...platformShares(platforms).map(share => ({ label: PLATFORM_LABELS[share.platform] ?? share.platform, value: share.activeUsers, percent: share.percent })),
  ];
}

/**
 * 분석 > 플랫폼: distinct active users per platform in the range (0 shown as 0; Unknown only when present), the share of all distinct
 * active users, the same since tracking started, and a daily chart per platform. Days before tracking started are no data.
 */
export default function AnalyticsPlatformsPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.platformsTitle}`}>
        {data => {
          const days = data.series.map(day => day.date);
          const tracked = (pick: (day: AnalyticsOverview['series'][number]) => number | undefined) =>
            activeSeries(data.series.map(day => ({ ...day, activeUsers: pick(day) ?? 0 })), data.activityTrackingSince);
          const hasUnknown = data.series.some(day => (day.activeUnknown ?? 0) > 0);
          return (
            <>
              <ShareList note={strings.platformsNote} rows={shareRows(data.platforms)} />
              {data.series.some(day => day.activeAndroid !== undefined) ? (
                <div className="charts">
                  <BarChart days={days} title={strings.chartAndroid} values={tracked(day => day.activeAndroid)} />
                  <BarChart days={days} title={strings.chartIos} values={tracked(day => day.activeIos)} />
                  <BarChart days={days} title={strings.chartWeb} values={tracked(day => day.activeWeb)} />
                  {hasUnknown ? <BarChart days={days} title={strings.chartUnknown} values={tracked(day => day.activeUnknown)} /> : null}
                </div>
              ) : null}
              {data.platformsSinceTrackingStart ? (
                <ShareList
                  note={`${strings.platformsSinceNote}${data.activityTrackingSince ? ` (${strings.analyticsTrackingSince}: ${data.activityTrackingSince})` : ''}`}
                  rows={shareRows(data.platformsSinceTrackingStart)}
                  title={`${strings.platformsSinceTitle} · ${formatCount(data.platformsSinceTrackingStart.activeUsersInRange)}`}
                />
              ) : null}
            </>
          );
        }}
      </AnalyticsFrame>
    </Suspense>
  );
}
