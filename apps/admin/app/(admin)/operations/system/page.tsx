'use client';

import { useEffect, useState } from 'react';
import { checkApiHealth, type ApiHealth } from '../../../../lib/adminApi';
import { adminPaths, formatInstant, type SystemResponse } from '../../../../lib/adminModel';
import { strings } from '../../../../lib/strings';
import { PageState, useAdmin, useAdminQuery } from '../../AdminRoot';

const HEALTH_LABELS: Readonly<Record<ApiHealth, string>> = {
  healthy: strings.systemHealthy,
  unhealthy: strings.systemUnhealthy,
  unreachable: strings.systemUnreachable,
};

/** 시스템 상태: the API's liveness, which environment / build it is, and which Admin Web build this is. No configuration values. */
export default function SystemPage() {
  const { config } = useAdmin();
  const { data, error, loading, reload } = useAdminQuery<SystemResponse>(adminPaths.system);
  const [attempt, setAttempt] = useState(0);
  // The result of the CURRENT attempt only; an earlier one is not shown while a re-check runs.
  const [checked, setChecked] = useState<{ attempt: number; health: ApiHealth } | null>(null);
  const health = checked?.attempt === attempt ? checked.health : null;

  useEffect(() => {
    let cancelled = false;
    void checkApiHealth(config.apiBaseUrl).then(result => {
      if (!cancelled) {
        setChecked({ attempt, health: result });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [config.apiBaseUrl, attempt]);

  return (
    <>
      <header className="page-header">
        <h1>{strings.systemTitle}</h1>
        <button
          onClick={() => {
            reload();
            setAttempt(value => value + 1);
          }}
          type="button"
        >
          {strings.retry}
        </button>
      </header>
      <dl className="facts">
        <dt>{strings.systemApiHealth}</dt>
        <dd>
          {health ? <span className={`badge health-${health}`}>{HEALTH_LABELS[health]}</span> : strings.loading}
        </dd>
        <dt>{strings.systemAdminVersion}</dt>
        <dd className="ltr">{config.buildVersion ?? strings.systemUnknown}</dd>
        {data ? (
          <>
            <dt>{strings.systemEnvironment}</dt>
            <dd className="ltr">{data.environment}</dd>
            <dt>{strings.systemApiVersion}</dt>
            <dd className="ltr break">{data.apiVersion ?? strings.systemUnknown}</dd>
            <dt>{strings.systemServerTime}</dt>
            <dd>{formatInstant(data.serverTimeUtc)}</dd>
          </>
        ) : null}
      </dl>
      <PageState error={error} loading={loading && !data} onRetry={reload} />
    </>
  );
}
