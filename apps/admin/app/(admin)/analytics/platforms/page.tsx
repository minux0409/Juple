'use client';

import { Suspense } from 'react';
import { formatCount } from '../../../../lib/adminModel';
import { platformShares } from '../../../../lib/analytics';
import { strings } from '../../../../lib/strings';
import { AnalyticsFrame } from '../AnalyticsParts';

const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  Android: strings.platformAndroid,
  Ios: strings.platformIos,
  Web: strings.platformWeb,
  Unknown: strings.platformUnknown,
};

/** 분석 > 플랫폼: distinct active users per platform in the range (0 shown as 0), with the share of all distinct active users. */
export default function AnalyticsPlatformsPage() {
  return (
    <Suspense fallback={<p className="state">{strings.loading}</p>}>
      <AnalyticsFrame title={`${strings.analyticsTitle} · ${strings.platformsTitle}`}>
        {data => (
          <section className="card platform-card">
            <p className="muted">{strings.platformsNote}</p>
            <dl className="policy-rows">
              <div>
                <dt>{strings.platformsTotal}</dt>
                <dd>{formatCount(data.platforms.activeUsersInRange)}</dd>
              </div>
              {platformShares(data.platforms).map(share => (
                <div key={share.platform}>
                  <dt>{PLATFORM_LABELS[share.platform] ?? share.platform}</dt>
                  <dd>
                    {formatCount(share.activeUsers)} <span className="muted">({share.percent}%)</span>
                  </dd>
                  <div aria-hidden="true" className="share-bar">
                    <span style={{ width: `${Math.min(100, share.percent)}%` }} />
                  </div>
                </div>
              ))}
            </dl>
          </section>
        )}
      </AnalyticsFrame>
    </Suspense>
  );
}
