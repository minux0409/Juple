'use client';

import { useRef, useState } from 'react';
import { ApiHttpError } from '../../../lib/adminApi';
import { failureMessage, normalizeMembershipLookup } from '../../../lib/adminModel';
import { strings } from '../../../lib/strings';
import { useAdmin, useAdminQuery } from '../AdminRoot';
import { LoadState, PageTitle, Panel } from '../v2/ui';

const copy = strings.membership;
const path = '/api/v1/admin/membership';

interface Grant {
  id: string;
  kind: 'preview' | 'complimentary';
  status: 'active' | 'scheduled' | 'expired' | 'revoked';
  grantedByUserId: number;
  grantedAtUtc: string;
  startsAtUtc: string;
  endsAtUtc: string | null;
  reason: string;
  revokedByUserId: number | null;
  revokedAtUtc: string | null;
  revokeReason: string | null;
}

interface Membership {
  user: { userId: number; jupleId: string; displayName: string | null; trialEndsAtUtc: string | null };
  configuredPreview: boolean;
  managedPreview: boolean;
  programEnabled: boolean;
  membershipOffered: boolean;
  complimentaryEndsAtUtc: string | null;
  storeSubscription: {
    state: 'none' | 'active' | 'gracePeriod';
    endedState: 'expired' | 'revoked' | null;
    platform: 'apple' | 'google' | null;
    currentPeriodEndsAtUtc: string | null;
  };
  canEditPreview: boolean;
  canEditComplimentary: boolean;
  history: Grant[];
}

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';
const yesNo = (value: boolean) => value ? copy.yes : copy.no;

export default function MembershipPage() {
  const [field, setField] = useState<'jupleId' | 'userId'>('jupleId');
  const [input, setInput] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [searchPath, setSearchPath] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const results = useAdminQuery<{ users: { jupleId: string }[]; hasMore: boolean }>(searchPath);
  const resource = useAdminQuery<Membership>(query);

  function showMembership(type: typeof field, value: string) {
    const next = `${path}/user?${new URLSearchParams({ [type]: value })}`;
    if (query === next) resource.reload();
    else setQuery(next);
  }

  return (
    <>
      <PageTitle title={copy.title} />
      <Panel>
        <form className="v2-toolbar" onSubmit={event => {
          event.preventDefault();
          const value = normalizeMembershipLookup(field, input);
          if (value === null) {
            setSearchPath(null);
            setQuery(null);
            setValidation(field === 'jupleId' ? copy.invalidJupleId : copy.invalidUserId);
            return;
          }
          setValidation(null);
          if (field === 'jupleId' && value.length < 8) {
            setQuery(null);
            const next = `${path}/users?${new URLSearchParams({ jupleId: value })}`;
            if (searchPath === next) results.reload();
            else setSearchPath(next);
          } else {
            setSearchPath(null);
            showMembership(field, value);
          }
        }}>
          <select aria-label={copy.searchField} value={field} onChange={event => setField(event.target.value === 'userId' ? 'userId' : 'jupleId')}>
            <option value="jupleId">{copy.jupleId}</option>
            <option value="userId">{copy.userId}</option>
          </select>
          <input aria-label={copy.searchValue} aria-invalid={Boolean(validation)} autoComplete="off" maxLength={32} value={input} onChange={event => { setInput(event.target.value); setValidation(null); }} />
          <button className="primary" type="submit">{copy.search}</button>
        </form>
        {validation && <p role="alert">{validation}</p>}
      </Panel>
      {searchPath && (results.loading || results.error
        ? <LoadState loading={results.loading} error={results.error} onRetry={results.reload} />
        : results.data && <Panel>
          <h2>{copy.searchResults}</h2>
          {results.data.users.length === 0 ? <p role="status">{copy.noResults}</p> : (
            <ul>
              {results.data.users.map(user => <li key={user.jupleId}><button type="button" onClick={() => showMembership('jupleId', user.jupleId)}>{user.jupleId}</button></li>)}
            </ul>
          )}
          {results.data.hasMore && <p>{copy.refineSearch}</p>}
        </Panel>)}
      {query && (resource.loading || resource.error)
        ? resource.error === strings.notFound
          ? <Panel><p role="status">{copy.noResults}</p></Panel>
          : <LoadState loading={resource.loading} error={resource.error} onRetry={resource.reload} />
        : resource.data && <AccountMembership key={resource.data.user.userId} data={resource.data} reload={resource.reload} />}
    </>
  );
}

function AccountMembership({ data, reload }: { data: Membership; reload: () => void }) {
  const { api, reportFailure } = useAdmin();
  const [action, setAction] = useState<'preview' | 'complimentary' | Grant | null>(null);
  const [reason, setReason] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const grantPath = `${path}/users/${data.user.userId}/grants`;
  const subscription = data.storeSubscription;
  const subscriptionState = subscription.state === 'none' ? subscription.endedState ?? 'none' : subscription.state;
  const actionAllowed = action && (action === 'preview' || (typeof action === 'object' && action.kind === 'preview')
    ? data.canEditPreview : data.canEditComplimentary);

  function choose(next: typeof action) {
    setAction(next);
    setReason('');
    setStartsAt('');
    setEndsAt('');
    setError(null);
    request.current = null;
  }

  async function save() {
    if (!action || !actionAllowed || pending.current || !reason.trim()) return;
    const period = action === 'complimentary' ? [new Date(startsAt), new Date(endsAt)] : null;
    if (period && (!Number.isFinite(+period[0]) || !Number.isFinite(+period[1]) || +period[0] >= +period[1])) {
      setError(copy.invalidPeriod);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    try {
      if (typeof action === 'object') {
        await api({ path: `${grantPath}/${action.id}/revocation`, method: 'PUT', body: { reason } });
      } else {
        const body = { kind: action, reason: reason.trim(), startsAtUtc: period?.[0].toISOString(), endsAtUtc: period?.[1].toISOString() };
        const payload = JSON.stringify(body);
        if (request.current?.payload !== payload) request.current = { id: crypto.randomUUID(), payload };
        await api({ path: grantPath, method: 'PUT', body: { ...body, requestId: request.current.id } });
      }
      choose(null);
      reload();
    } catch (failure) {
      reportFailure(failure);
      setError(failure instanceof ApiHttpError && failure.status === 409 ? copy.conflict : failureMessage(failure));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <>
      <Panel>
        <h2>{data.user.displayName ?? data.user.jupleId}</h2>
        <dl>
          <dt>{copy.jupleId}</dt><dd>{data.user.jupleId}</dd>
          <dt>{copy.userId}</dt><dd>{data.user.userId}</dd>
          <dt>{copy.storeSubscription}</dt><dd>{copy.storeStates[subscriptionState]}{subscription.platform ? ` · ${subscription.platform === 'apple' ? 'App Store' : 'Google Play'}` : ''}{subscription.currentPeriodEndsAtUtc ? ` · ${date(subscription.currentPeriodEndsAtUtc)}` : ''}</dd>
          <dt>{copy.trialEnd}</dt><dd>{date(data.user.trialEndsAtUtc)}</dd>
          <dt>{copy.programEnabled}</dt><dd>{yesNo(data.programEnabled)}</dd>
          <dt>{copy.configuredPreview}</dt><dd>{yesNo(data.configuredPreview)}</dd>
          <dt>{copy.managedPreview}</dt><dd>{yesNo(data.managedPreview)}</dd>
          <dt>{copy.membershipOffered}</dt><dd>{yesNo(data.membershipOffered || Boolean(data.complimentaryEndsAtUtc))}</dd>
          <dt>{copy.complimentary}</dt><dd>{data.complimentaryEndsAtUtc ? `${copy.active} · ${date(data.complimentaryEndsAtUtc)}` : copy.unavailable}</dd>
        </dl>
        {data.canEditPreview ? (
          <div className="v2-toolbar">
            <button disabled={saving || data.managedPreview || data.configuredPreview} onClick={() => choose('preview')} type="button">{copy.allowPreview}</button>
            {data.canEditComplimentary && <button disabled={saving} onClick={() => choose('complimentary')} type="button">{copy.grant}</button>}
          </div>
        ) : <p>{copy.forbidden}</p>}
        {data.canEditPreview && !data.canEditComplimentary && <p>{copy.selfComplimentaryForbidden}</p>}
        {actionAllowed && action && (
          <form onSubmit={event => { event.preventDefault(); void save(); }}>
            <h3>{action === 'preview' ? copy.allowPreview : action === 'complimentary' ? copy.grant : copy.revoke}</h3>
            {action === 'complimentary' && (
              <>
                <p>{copy.localTime}</p>
                <div className="v2-toolbar">
                  <label>{copy.start} <input type="datetime-local" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
                  <label>{copy.end} <input type="datetime-local" required value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label>
                </div>
              </>
            )}
            <div className="v2-toolbar">
              <label>{copy.reason} <input required maxLength={512} value={reason} onChange={event => setReason(event.target.value)} /></label>
              <button className="primary" disabled={saving} type="submit">{action === 'preview' ? copy.allowPreview : action === 'complimentary' ? copy.grant : copy.revoke}</button>
            </div>
            {error && <p role="alert">{error}</p>}
          </form>
        )}
      </Panel>
      <Panel>
        <h2>{copy.history}</h2>
        {data.history.length === 0 ? <p>{copy.empty}</p> : (
          <div className="v2-table-scroll">
            <table className="v2-table">
              <thead><tr><th>{copy.history}</th><th>{copy.start} / {copy.end}</th><th>{copy.grantedAt} · {copy.by} · {copy.reason}</th><th>{copy.revokedAt} · {copy.by} · {copy.reason}</th><th>{copy.revoke}</th></tr></thead>
              <tbody>
                {data.history.map(grant => (
                  <tr key={grant.id}>
                    <td>{grant.kind === 'preview' ? copy.managedPreview : copy.complimentary} · {copy[grant.status]}</td>
                    <td>{date(grant.startsAtUtc)} / {date(grant.endsAtUtc)}</td>
                    <td>{date(grant.grantedAtUtc)} · {grant.grantedByUserId} · {grant.reason}</td>
                    <td>{grant.revokedAtUtc ? `${date(grant.revokedAtUtc)} · ${grant.revokedByUserId} · ${grant.revokeReason}` : '—'}</td>
                    <td>{(grant.kind === 'preview' ? data.canEditPreview : data.canEditComplimentary) && (grant.status === 'active' || grant.status === 'scheduled') && <button disabled={saving} type="button" onClick={() => choose(grant)}>{copy.revoke}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
