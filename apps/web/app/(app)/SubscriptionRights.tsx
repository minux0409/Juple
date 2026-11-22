'use client';

import { useEffect, useRef, useState } from 'react';
import type { AppApi } from '../../lib/appApi';
import type { AppDictionary } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';

const path = '/api/v1/billing/subscription-management';
type Ownership = { state: string; currentPeriodEndsAtUtc: string | null };

/** Deliberately outside the general service shell: no purchase/catalog or ordinary-service navigation. */
export function SubscriptionRights({ api, dictionary: d, onSessionLost }: { api: AppApi; dictionary: AppDictionary; onSessionLost: () => void }) {
  const [loaded, setOwned] = useState<{ api: AppApi; value: Ownership } | null>(null);
  const owned = loaded?.api === api ? loaded.value : null;
  const [failed, setFailed] = useState(false);
  const [busyApi, setBusy] = useState<AppApi | null>(null);
  const busy = busyApi === api;
  const [message, setMessage] = useState('');
  const lifetime = useRef({ active: false });
  const inFlight = useRef(false);
  useEffect(() => {
    const run = { active: true }; lifetime.current = run;
    inFlight.current = false;
    return () => { run.active = false; };
  }, [api]);
  const run = async (platform?: 'google' | 'apple') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(() => api); setFailed(false); setMessage('');
    const scope = lifetime.current;
    try {
      if (platform) {
        const result = await api<{ outcome: string }>({ method: 'POST', path: `${path}/restore/${platform}` });
        if (!['Restored', 'NothingFound'].includes(result.outcome)) throw new Error('restore failed');
        if (!scope.active) return;
        if (result.outcome === 'NothingFound') setMessage(d.subscriptionRestoreNothingFound);
      }
      const state = await api<Ownership>({ method: 'GET', path });
      if (!state || typeof state.state !== 'string') throw new Error('invalid ownership');
      if (scope.active) setOwned({ api, value: state });
    } catch (error) { if (scope.active) { if (isSessionLost(error)) onSessionLost(); else setFailed(true); } }
    finally { if (scope.active) { setBusy(null); inFlight.current = false; } }
  };
  const status = owned?.state === 'Active' ? d.subscriptionStatusActive : owned?.state === 'Canceled' ? d.subscriptionStatusCanceled : owned?.state === 'Revoked' ? d.subscriptionStatusRevoked : owned?.state === 'GracePeriod' ? d.subscriptionStatusGracePeriod : owned?.state === 'Expired' ? d.subscriptionStatusExpired : owned?.state === 'None' ? d.subscriptionStatusNone : d.subscriptionStatusUnknown;
  return <section aria-label={d.subscriptionManage}>
    <h2>{d.subscriptionManage}</h2>
    {owned ? <p>{status}{owned.currentPeriodEndsAtUtc ? ` · ${owned.currentPeriodEndsAtUtc}` : ''}</p> : null}
    {failed ? <p role="alert">{d.subscriptionRestoreFailed}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <button type="button" disabled={busy} onClick={() => { void run(); }}>{d.subscriptionStateHeading}</button>
    <button type="button" disabled={busy} onClick={() => { void run('google'); }}>{d.subscriptionRestore} · Google Play</button>
    <button type="button" disabled={busy} onClick={() => { void run('apple'); }}>{d.subscriptionRestore} · App Store</button>
    <p><a href="https://play.google.com/store/account/subscriptions" target="_blank" rel="noopener noreferrer">Google Play · {d.subscriptionManage}</a></p>
    <p><a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">App Store · {d.subscriptionManage}</a></p>
  </section>;
}
