'use client';

import { useState } from 'react';
import { ApiHttpError } from '../../../../lib/adminApi';
import {
  adminPaths,
  appVersionEditState,
  appVersionWriteBody,
  failureMessage,
  formatInstant,
  planAppVersionChange,
  policyView,
  type AppPlatform,
  type AppVersionEditState,
  type AppVersionResponse,
} from '../../../../lib/adminModel';
import { strings } from '../../../../lib/strings';
import { PageState, useAdmin, useAdminQuery } from '../../AdminRoot';

type Message = { readonly kind: 'ok' | 'error'; readonly text: string };

const PLATFORMS: readonly { readonly platform: AppPlatform; readonly name: string }[] = [
  { platform: 'android', name: 'Android' },
  { platform: 'ios', name: 'iOS' },
];

/**
 * 앱 버전: the MobileVersionPolicy the API serves, and - for the Owner - one editor per platform. Each platform is saved on its own
 * (PUT .../app-version/{platform}); the API re-validates everything and answers with a fresh read of both platforms, which this
 * page then shows. A save that lost a race (409) reloads the page's values instead of overwriting.
 */
export default function AppVersionPage() {
  const { data, error, loading, reload } = useAdminQuery<AppVersionResponse>(adminPaths.appVersion);
  // The API's fresh read after a save wins over the first load until the page reloads.
  const [saved, setSaved] = useState<AppVersionResponse | null>(null);
  const [messages, setMessages] = useState<Partial<Record<AppPlatform, Message>>>({});
  const current = saved ?? data;

  const setMessage = (platform: AppPlatform, message: Message | null) =>
    setMessages(previous => ({ ...previous, [platform]: message ?? undefined }));

  return (
    <>
      <header className="page-header">
        <h1>{strings.appVersionTitle}</h1>
      </header>
      <p className="muted">{strings.appVersionNote}</p>
      <PageState error={error} loading={loading && !current} onRetry={reload} />
      {current ? (
        <section className="policy-cards">
          {PLATFORMS.map(({ platform, name }) => {
            const raw = current[platform];
            const edit = appVersionEditState(raw);
            const message = messages[platform];
            return (
              <div className="card policy-card" data-platform={name} key={platform}>
                <PolicySummary edit={edit} name={name} raw={raw} />
                {edit === null ? (
                  <p className="muted">{strings.policyNotEditable}</p>
                ) : edit.canEdit ? (
                  <PolicyEditor
                    // A new server state (another save, a reload) starts a fresh draft from the stored values.
                    key={`${platform}:${edit.version ?? 'configuration'}:${edit.latestBuild}:${edit.minimumSupportedBuild}`}
                    name={name}
                    onConflict={() => {
                      setSaved(null);
                      setMessage(platform, { kind: 'error', text: strings.policyConflict });
                      reload();
                    }}
                    onSaved={response => {
                      setSaved(response);
                      setMessage(platform, { kind: 'ok', text: strings.saved });
                    }}
                    onStart={() => setMessage(platform, null)}
                    platform={platform}
                    state={edit}
                  />
                ) : (
                  <p className="muted">{strings.policyOwnerOnly}</p>
                )}
                {message ? (
                  <p className={message.kind === 'ok' ? 'notice ok' : 'notice error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
                    {message.text}
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

/** One platform's served values: title + state, then label/value rows that wrap instead of leaving the card. */
function PolicySummary({ name, raw, edit }: { name: string; raw: unknown; edit: AppVersionEditState | null }) {
  const view = policyView(raw);
  return (
    <>
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
      {edit ? (
        <dl className="policy-rows">
          <div>
            <dt>{strings.policySource}</dt>
            <dd className="policy-source">{edit.source === 'database' ? strings.policySourceDatabase : strings.policySourceConfiguration}</dd>
          </div>
          <div>
            <dt>{strings.policyUpdatedAt}</dt>
            <dd className="policy-source">{formatInstant(edit.updatedAtUtc)}</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

function PolicyEditor({
  platform,
  name,
  state,
  onStart,
  onSaved,
  onConflict,
}: {
  platform: AppPlatform;
  name: string;
  state: AppVersionEditState;
  onStart: () => void;
  onSaved: (response: AppVersionResponse) => void;
  onConflict: () => void;
}) {
  const { api, reportFailure } = useAdmin();
  const [latestText, setLatestText] = useState(state.latestBuild > 0 ? String(state.latestBuild) : '');
  const [minimumText, setMinimumText] = useState(state.minimumSupportedBuild > 0 ? String(state.minimumSupportedBuild) : '');
  const [confirmRaise, setConfirmRaise] = useState(false);
  const [confirmLower, setConfirmLower] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const plan = planAppVersionChange(state, latestText, minimumText);
  const ids = { latest: `${platform}-latest`, minimum: `${platform}-minimum` };

  const save = async () => {
    setProblem(null);
    if (plan.kind === 'invalid') {
      setProblem(plan.reason === 'minimumAboveLatest' ? strings.policyMinimumAboveLatest : strings.policyNotABuild);
      return;
    }
    if (plan.kind === 'unchanged') {
      setProblem(strings.policyUnchanged);
      return;
    }
    if ((plan.raisesMinimum && !confirmRaise) || (plan.lowersLatest && !confirmLower)) {
      setProblem(strings.policyConfirmRequired);
      return;
    }
    const summary = [
      `${strings.policyConfirmTitle}`,
      '',
      name,
      `${strings.policyLatest}: ${state.latestBuild} → ${plan.latestBuild}`,
      `${strings.policyMinimum}: ${state.minimumSupportedBuild} → ${plan.minimumSupportedBuild}`,
      ...(plan.raisesMinimum ? ['', strings.policyRaiseWarning] : []),
      ...(plan.lowersLatest ? ['', strings.policyLowerWarning] : []),
      '',
      strings.appVersionStoreFirst,
    ].join('\n');
    if (!window.confirm(summary)) {
      return;
    }
    setBusy(true);
    onStart();
    try {
      const response = await api<AppVersionResponse>({
        method: 'PUT',
        path: adminPaths.appVersionPlatform(platform),
        body: appVersionWriteBody(plan, state.version, { minimumIncrease: confirmRaise, latestDecrease: confirmLower }),
      });
      onSaved(response);
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 409) {
        onConflict();
      } else {
        reportFailure(error);
        setProblem(failureMessage(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="policy-form"
      onSubmit={event => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>{strings.policyEditTitle}</h3>
      <div className="policy-fields">
        <label htmlFor={ids.latest}>
          {strings.policyNewLatest}
          <input
            disabled={busy}
            id={ids.latest}
            inputMode="numeric"
            onChange={event => setLatestText(event.target.value)}
            value={latestText}
          />
        </label>
        <label htmlFor={ids.minimum}>
          {strings.policyNewMinimum}
          <input
            disabled={busy}
            id={ids.minimum}
            inputMode="numeric"
            onChange={event => setMinimumText(event.target.value)}
            value={minimumText}
          />
        </label>
      </div>
      {plan.kind === 'change' ? (
        <dl className="policy-rows policy-diff">
          <div>
            <dt>{strings.policyLatest}</dt>
            <dd>
              {state.latestBuild} → {plan.latestBuild}
            </dd>
          </div>
          <div>
            <dt>{strings.policyMinimum}</dt>
            <dd>
              {state.minimumSupportedBuild} → {plan.minimumSupportedBuild}
            </dd>
          </div>
        </dl>
      ) : null}
      {plan.kind === 'change' && plan.raisesMinimum ? (
        <div className="policy-warning" role="alert">
          <p>{strings.policyRaiseWarning}</p>
          <label className="check">
            <input checked={confirmRaise} disabled={busy} onChange={event => setConfirmRaise(event.target.checked)} type="checkbox" />
            {strings.policyRaiseConfirm}
          </label>
        </div>
      ) : null}
      {plan.kind === 'change' && plan.lowersLatest ? (
        <div className="policy-warning" role="alert">
          <p>{strings.policyLowerWarning}</p>
          <label className="check">
            <input checked={confirmLower} disabled={busy} onChange={event => setConfirmLower(event.target.checked)} type="checkbox" />
            {strings.policyLowerConfirm}
          </label>
        </div>
      ) : null}
      <p className="muted">{strings.appVersionStoreFirst}</p>
      <div className="actions">
        <button className="primary" disabled={busy || plan.kind === 'unchanged'} type="submit">
          {busy ? strings.policySaving : strings.policySave}
        </button>
      </div>
      {problem ? (
        <p className="notice error" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
