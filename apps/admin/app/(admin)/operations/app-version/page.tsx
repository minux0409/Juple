'use client';

import { adminPaths, type AppVersionPolicy, type AppVersionResponse } from '../../../../lib/adminModel';
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
        <section className="cards">
          <Policy name="Android" policy={data.android} />
          <Policy name="iOS" policy={data.ios} />
        </section>
      ) : null}
    </>
  );
}

function Policy({ name, policy }: { name: string; policy: AppVersionPolicy }) {
  return (
    <div className="card">
      <div className="card-label">{name}</div>
      <dl className="facts">
        <dt>{strings.policyEnabled}</dt>
        <dd>{policy.enabled ? strings.policyOn : strings.policyOff}</dd>
        <dt>{strings.policyLatest}</dt>
        <dd>{policy.enabled ? policy.latestBuild : '-'}</dd>
        <dt>{strings.policyMinimum}</dt>
        <dd>{policy.enabled ? policy.minimumSupportedBuild : '-'}</dd>
        <dt>{strings.policyStoreUrl}</dt>
        <dd className="ltr break">{policy.storeUrl ?? '-'}</dd>
      </dl>
    </div>
  );
}
