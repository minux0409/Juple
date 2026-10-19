'use client';

import { Suspense } from 'react';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame } from '../AnalyticsParts';

/** 분석 > 국가: no country source exists yet (docs/analytics.md), so nothing is estimated - the page says so. */
export default function AnalyticsCountriesPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.countriesTitle}`}>
        {data =>
          data.countries.available ? null : (
            <section className="card">
              <p>{strings.countriesNotCollected}</p>
              <p className="muted">{strings.countriesPrivacy}</p>
            </section>
          )
        }
      </AnalyticsFrame>
    </Suspense>
  );
}
