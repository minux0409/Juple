'use client';

import { Suspense } from 'react';
import { activeSeries } from '../../../lib/analytics';
import { strings } from '../../../lib/strings';
import { AnalyticsFrame, BarChart, Kpis } from './AnalyticsParts';

/** 분석 > 개요: the headline numbers and one chart (daily active users). */
export default function AnalyticsOverviewPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.navAnalyticsOverview}`}>
        {data => (
          <>
            <Kpis
              items={[
                [strings.kpiTotalUsers, data.users.total],
                [strings.kpiDau, data.users.dau],
                [strings.kpiWau, data.users.wau],
                [strings.kpiMau, data.users.mau],
                [strings.kpiSavedToday, data.links.savedToday],
                [strings.kpiSaved30, data.links.saved30Days],
                [strings.kpiTotalCollections, data.collections.totalLive],
                [strings.kpiNew30, data.users.new30Days],
              ]}
            />
            <BarChart days={data.series.map(day => day.date)} title={strings.chartActiveUsers} values={activeSeries(data.series, data.activityTrackingSince)} />
          </>
        )}
      </AnalyticsFrame>
    </Suspense>
  );
}
