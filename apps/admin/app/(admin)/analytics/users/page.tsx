'use client';

import { Suspense } from 'react';
import { activeSeries } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame, BarChart, Kpis } from '../AnalyticsParts';

/** 분석 > 사용자: accounts, DAU / WAU / MAU, signups and daily active users. Retention (D1/D7/D30) waits for more activity data. */
export default function AnalyticsUsersPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.navAnalyticsUsers}`}>
        {data => (
          <>
            <Kpis
              items={[
                [strings.kpiTotalUsers, data.users.total],
                [strings.kpiDau, data.users.dau],
                [strings.kpiWau, data.users.wau],
                [strings.kpiMau, data.users.mau],
                [strings.kpiNewToday, data.users.newToday],
                [strings.kpiNew7, data.users.new7Days],
                [strings.kpiNew30, data.users.new30Days],
                [strings.kpiNewInRange, data.users.newInRange],
              ]}
            />
            <div className="charts">
              <BarChart days={data.series.map(day => day.date)} title={strings.chartSignups} values={data.series.map(day => day.signups)} />
              <BarChart days={data.series.map(day => day.date)} title={strings.chartActiveUsers} values={activeSeries(data.series, data.activityTrackingSince)} />
            </div>
          </>
        )}
      </AnalyticsFrame>
    </Suspense>
  );
}
