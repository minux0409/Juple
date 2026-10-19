'use client';

import { Suspense } from 'react';
import { formatCount } from '../../../../lib/adminModel';
import { holdingRows, percentOf, savesPerSaver, type LinkHoldings } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame, BarChart, Kpis, ShareList } from '../AnalyticsParts';

/**
 * 분석 > 저장 활동: first what every account holds RIGHT NOW (live links, trash excluded, accounts without links included), then the
 * saved-per-day activity (counted from the links that still exist - see the note). The two are different numbers on purpose.
 */
export default function AnalyticsSavesPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.navAnalyticsSaves}`}>
        {data => {
          const average = savesPerSaver(data.links.savedInRange, data.links.uniqueSaversInRange);
          return (
            <>
              {data.linkHoldings ? <HoldingsSection holdings={data.linkHoldings} savedToday={data.links.savedToday} /> : null}
              <section className="section">
                <h2>{strings.savesActivityTitle}</h2>
                <Kpis
                  items={[
                    [strings.kpiSavedToday, data.links.savedToday],
                    [strings.kpiSaved7, data.links.saved7Days],
                    [strings.kpiSaved30, data.links.saved30Days],
                    [strings.kpiSavedInRange, data.links.savedInRange],
                    [strings.kpiUniqueSavers, data.links.uniqueSaversInRange],
                    [strings.kpiSavesPerSaver, average === null ? '-' : average.toLocaleString()],
                    [strings.kpiTotalCollections, data.collections.totalLive],
                    [strings.kpiSharedCollections, data.collections.sharedLive],
                    [strings.kpiCreatedInRange, data.collections.createdInRange],
                  ]}
                />
                <p className="muted">{strings.savesNote}</p>
                <div className="charts">
                  <BarChart days={data.series.map(day => day.date)} title={strings.chartLinksSaved} unit="개" values={data.series.map(day => day.linksSaved)} />
                  <BarChart days={data.series.map(day => day.date)} title={strings.chartCollectionsCreated} unit="개" values={data.series.map(day => day.collectionsCreated)} />
                </div>
              </section>
            </>
          );
        }}
      </AnalyticsFrame>
    </Suspense>
  );
}

function HoldingsSection({ holdings, savedToday }: { holdings: LinkHoldings; savedToday: number }) {
  return (
    <section className="section">
      <h2>{strings.holdingsTitle}</h2>
      <p className="muted">{strings.holdingsNote}</p>
      <Kpis
        items={[
          [strings.holdingsTotal, holdings.totalLiveLinks],
          [strings.kpiSavedToday, savedToday],
          [strings.holdingsMax, holdings.maxLinksPerUser],
          [strings.holdingsAtMax, holdings.usersAtMax],
          [strings.holdingsUsersWithLinks, `${formatCount(holdings.usersWithLinks)} (${percentOf(holdings.usersWithLinks, holdings.totalUsers)}%)`],
        ]}
      />
      <div className="charts">
        <ShareList rows={holdingRows(holdings).map(row => ({ label: row.key, value: row.value, percent: row.percent }))} title={strings.holdingsDistribution} unit="명" />
        <section className="card platform-card">
          <h2 className="card-title">{strings.holdingsTop}</h2>
          {holdings.topHolders.length === 0 ? (
            <p className="muted">{strings.holdingsTopEmpty}</p>
          ) : (
            <ol className="top-list">
              {holdings.topHolders.map(holder => (
                <li key={holder.jupleId}>
                  <span className="ltr">@{holder.jupleId.slice(0, 4)}-{holder.jupleId.slice(4)}</span>
                  <span>{formatCount(holder.liveLinks)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
