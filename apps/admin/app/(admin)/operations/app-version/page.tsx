'use client';

import { adminPaths, policyView, type AppVersionResponse } from '../../../../lib/adminModel';
import { strings } from '../../../../lib/strings';
import { PageState, useAdminQuery } from '../../AdminRoot';

/** 앱 버전: the MobileVersionPolicy the API is serving right now. Read-only - it changes only through a configuration deployment. */
export default function AppVersionPage() {
  const { data, error, loading, reload } = useAdminQuery<AppVersionResponse>(adminPaths.appVersion);
  return (
    <>
      <header className="page-header">
        <h1>{strings.appVersionTitle}</h1>
      </header>
      <p className="muted">{strings.appVersionNote}</p>
      <PageState error={error} loading={loading && !data} onRetry={reload} />
      {data ? (
        <section className="policy-cards">
          <PolicyCard name="Android" raw={data.android} />
          <PolicyCard name="iOS" raw={data.ios} />
        </section>
      ) : null}
    </>
  );
}

/** One platform, entirely inside its card: title + state, then label/value rows that wrap instead of leaving the card. */
function PolicyCard({ name, raw }: { name: string; raw: unknown }) {
  const view = policyView(raw);
  return (
    <div className="card policy-card" data-platform={name}>
      <div className="policy-head">
        <h2>
          {name} {strings.policyTitle}
        </h2>
        <span className={view.kind === 'configured' ? 'badge health-healthy' : 'badge'}>
          {view.kind === 'configured' ? strings.policyOn : strings.policyOff}
        </span>
      </div>
      {view.kind === 'configured' ? (
        <dl className="policy-rows">
          <div>
            <dt>{strings.policyLatest}</dt>
            <dd>{view.latestBuild}</dd>
          </div>
          <div>
            <dt>{strings.policyMinimum}</dt>
            <dd>{view.minimumSupportedBuild}</dd>
          </div>
          <div>
            <dt>{strings.policyStoreUrl}</dt>
            <dd className="ltr policy-url">
              {view.storeUrl ? (
                <a href={view.storeUrl} rel="noopener noreferrer" target="_blank">
                  {view.storeUrl}
                </a>
              ) : (
                '-'
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">{view.kind === 'notConfigured' ? strings.policyNotConfigured : strings.policyUnreadable}</p>
      )}
    </div>
  );
}
