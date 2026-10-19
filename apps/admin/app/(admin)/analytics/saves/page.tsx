'use client';

import { Suspense } from 'react';
import { savesPerSaver } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame, BarChart, Kpis } from '../AnalyticsParts';

/** 분석 > 저장 활동: saved links (and Collections created) per day. Counted from the links that still exist - see the note. */
export default function AnalyticsSavesPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.navAnalyticsSaves}`}>
        {data => {
          const average = savesPerSaver(data.links.savedInRange, data.links.uniqueSaversInRange);
          return (
            <>
              <Kpis
                items={[
                  [strings.kpiTotalLinks, data.links.totalLive],
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
                <BarChart days={data.series.map(day => day.date)} title={strings.chartLinksSaved} values={data.series.map(day => day.linksSaved)} />
                <BarChart days={data.series.map(day => day.date)} title={strings.chartCollectionsCreated} values={data.series.map(day => day.collectionsCreated)} />
              </div>
            </>
          );
        }}
      </AnalyticsFrame>
    </Suspense>
  );
}
