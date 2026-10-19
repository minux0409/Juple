'use client';

import { Suspense } from 'react';
import { activeSeries, membershipRows, percentOf, type Membership } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame, BarChart, Kpis, ShareList } from '../AnalyticsParts';

const GROUP_LABELS: Readonly<Record<string, string>> = {
  paid: strings.membershipPaid,
  gracePeriod: strings.membershipGracePeriod,
  inTrial: strings.membershipInTrial,
  trialEndedUnpaid: strings.membershipTrialEndedUnpaid,
};

/**
 * 분석 > 사용자: accounts and membership state, DAU / WAU / MAU, signups and daily active users. Trial / paid groups exist only while
 * the billing program runs; otherwise the page says they cannot be counted (never 0). Retention (D1/D7/D30) waits for more data.
 */
export default function AnalyticsUsersPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.navAnalyticsUsers}`}>
        {data => (
          <>
            {data.membership ? <MembershipSection membership={data.membership} /> : null}
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
              <BarChart days={data.series.map(day => day.date)} title={strings.chartSignups} unit="명" values={data.series.map(day => day.signups)} />
              <BarChart days={data.series.map(day => day.date)} title={strings.chartActiveUsers} unit="명" values={activeSeries(data.series, data.activityTrackingSince)} />
            </div>
          </>
        )}
      </AnalyticsFrame>
    </Suspense>
  );
}

function MembershipSection({ membership }: { membership: Membership }) {
  const rows = membershipRows(membership);
  return (
    <section className="section">
      <h2>{strings.membershipTitle}</h2>
      <Kpis
        items={[
          [strings.kpiTotalUsers, membership.totalUsers],
          [strings.kpiNewToday, membership.newToday],
          [strings.membershipWithin30, membership.signedUpWithin30Days],
          [strings.membershipOver30, membership.signedUpOver30Days],
        ]}
      />
      <p className="muted">{strings.membershipAgeNote}</p>
      {rows ? (
        <ShareList
          note={strings.membershipGroupsNote}
          unit="명"
          rows={rows.map(row => ({ label: GROUP_LABELS[row.key] ?? row.key, value: row.value, percent: row.percent }))}
          title={`${strings.membershipTitle} · ${strings.membershipShare}`}
        />
      ) : (
        <p className="notice tracking">{strings.membershipNotLaunched}</p>
      )}
      {rows ? null : (
        <ShareList
          rows={[
            { label: strings.membershipWithin30, value: membership.signedUpWithin30Days, percent: percentOf(membership.signedUpWithin30Days, membership.totalUsers) },
            { label: strings.membershipOver30, value: membership.signedUpOver30Days, percent: percentOf(membership.signedUpOver30Days, membership.totalUsers) },
          ]}
          title={strings.membershipAgeNote}
          unit="명"
        />
      )}
    </section>
  );
}
