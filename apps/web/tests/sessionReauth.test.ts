import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, ApiNetworkError, AuthExpiredError, createAppApi } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { ACTIVE_CHECK_INTERVAL_MS, classifyTokenFailure, createSessionValidator, FOCUS_CHECK_INTERVAL_MS, type SessionCheck } from '../lib/sessionValidation.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appRoot = read('../app/(app)/AppRoot.tsx');
const reauthDialog = read('../app/(app)/ReauthDialog.tsx');
const msalClient = read('../lib/msalClient.ts');

/** A fake MSAL error: only name / errorCode matter (the message is never read). */
function msalError(name: string, errorCode: string): Error {
  return Object.assign(new Error('details are not inspected'), { name, errorCode });
}

describe('token failure classification', () => {
  it('an interaction-required answer means sign in again', () => {
    assert.equal(classifyTokenFailure(msalError('InteractionRequiredAuthError', 'login_required')), 'reauthRequired');
    assert.equal(classifyTokenFailure(msalError('InteractionRequiredAuthError', 'no_tokens_found')), 'reauthRequired');
  });

  it('a refresh token Entra rejected (revoked by a password reset) means sign in again', () => {
    assert.equal(classifyTokenFailure(msalError('ServerError', 'invalid_grant')), 'reauthRequired');
  });

  it('network failures, timeouts and outages never mean sign in again', () => {
    for (const code of ['no_network_connectivity', 'post_request_failed', 'monitor_window_timeout', 'timed_out', 'endpoints_resolution_error', 'server_unavailable']) {
      assert.equal(classifyTokenFailure(msalError('BrowserAuthError', code)), 'transient', code);
    }
    assert.equal(classifyTokenFailure(new TypeError('Failed to fetch')), 'transient');
    assert.equal(classifyTokenFailure(undefined), 'transient');
  });
});

function harness(results: SessionCheck[]) {
  let clock = 0;
  let calls = 0;
  let prompts = 0;
  const pending: Array<() => void> = [];
  const validator = createSessionValidator({
    now: () => clock,
    onReauthRequired: () => {
      prompts += 1;
    },
    validate: () => {
      calls += 1;
      const result = results.shift() ?? 'valid';
      return new Promise<SessionCheck>(resolve => pending.push(() => resolve(result)));
    },
  });
  return {
    validator,
    advance: (ms: number) => {
      clock += ms;
    },
    settle: async () => {
      while (pending.length) {
        pending.shift()!();
        await new Promise(resolve => setImmediate(resolve));
      }
    },
    get calls() {
      return calls;
    },
    get prompts() {
      return prompts;
    },
  };
}

describe('session validator', () => {
  it('a valid session (a reload, returning to the tab) asks Entra and shows nothing', async () => {
    const h = harness(['valid']);
    const result = h.validator.check(FOCUS_CHECK_INTERVAL_MS);
    await h.settle();
    assert.equal(await result, 'valid');
    assert.equal(h.prompts, 0);
  });

  it('is throttled: a focus within a minute and the five-minute tick do not ask again too soon', async () => {
    const h = harness([]);
    const first = h.validator.check(FOCUS_CHECK_INTERVAL_MS);
    await h.settle();
    await first;
    h.advance(30_000);
    assert.equal(await h.validator.check(FOCUS_CHECK_INTERVAL_MS), 'skipped');
    h.advance(31_000);
    assert.equal(await h.validator.check(ACTIVE_CHECK_INTERVAL_MS), 'skipped');
    const again = h.validator.check(FOCUS_CHECK_INTERVAL_MS);
    await h.settle();
    assert.equal(await again, 'valid');
    assert.equal(h.calls, 2);
  });

  it('runs one check at a time: overlapping triggers share it', async () => {
    const h = harness(['valid']);
    const a = h.validator.check(0);
    const b = h.validator.check(0);
    await h.settle();
    assert.deepEqual(await Promise.all([a, b]), ['valid', 'valid']);
    assert.equal(h.calls, 1);
  });

  it('a revoked session prompts exactly once however many checks follow', async () => {
    const h = harness(['reauthRequired', 'reauthRequired']);
    const a = h.validator.check(0);
    const b = h.validator.check(0);
    await h.settle();
    assert.equal(await a, 'reauthRequired');
    assert.equal(await b, 'reauthRequired');
    h.advance(ACTIVE_CHECK_INTERVAL_MS);
    assert.equal(await h.validator.check(0), 'reauthRequired');
    assert.equal(h.prompts, 1);
    assert.equal(h.calls, 1);
  });

  it('a network failure (or a check that throws) never prompts', async () => {
    const h = harness(['transient']);
    const a = h.validator.check(0);
    await h.settle();
    assert.equal(await a, 'transient');
    const failing = createSessionValidator({ validate: () => Promise.reject(new Error('offline')), onReauthRequired: () => assert.fail('must not prompt') });
    assert.equal(await failing.check(0), 'transient');
    assert.equal(h.prompts, 0);
  });
});

describe('API calls and the token source', () => {
  const ok = () => Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));

  it('a token source that cannot tell (offline) is a network failure - the session is kept', async () => {
    const api = createAppApi({ apiBaseUrl: 'https://api', fetchImpl: ok, getAccessToken: () => Promise.reject(new Error('offline')) });
    await assert.rejects(api({ path: '/x' }), ApiNetworkError);
  });

  it('no token at all (Entra says sign in again) is a lost session', async () => {
    const api = createAppApi({ apiBaseUrl: 'https://api', fetchImpl: ok, getAccessToken: () => Promise.resolve(null) });
    await assert.rejects(api({ path: '/x' }), AuthExpiredError);
  });

  it('an API 500 is an HTTP error, not a lost session', async () => {
    const api = createAppApi({
      apiBaseUrl: 'https://api',
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 500 })),
      getAccessToken: () => Promise.resolve('t'),
    });
    await assert.rejects(api({ path: '/x' }), (error: unknown) => error instanceof ApiHttpError && error.status === 500);
  });

  it('a 401 first refreshes the token once; the retry succeeds without any prompt', async () => {
    const forced: boolean[] = [];
    let n = 0;
    const api = createAppApi({
      apiBaseUrl: 'https://api',
      fetchImpl: () => Promise.resolve(n++ === 0 ? new Response('', { status: 401 }) : new Response('{"a":1}', { status: 200 })),
      getAccessToken: ({ forceRefresh }) => {
        forced.push(forceRefresh);
        return Promise.resolve('t');
      },
    });
    assert.deepEqual(await api({ path: '/x' }), { a: 1 });
    assert.deepEqual(forced, [false, true]);
  });

  it('acquireApiToken: interaction required -> null; anything else throws (kept session)', () => {
    assert.match(msalClient, /classifyTokenFailure\(error\) === 'reauthRequired'\) {\s*return null;/);
    assert.match(msalClient, /throw new TokenUnavailableError\(\);/);
  });

  it('only the session check forces a refresh - API calls use the cache unless the API answered 401', () => {
    assert.match(msalClient, /export async function checkSession[\s\S]*?forceRefresh: true/);
    assert.match(appRoot, /acquireApiToken\(msal, config, forceRefresh\)/);
  });
});

describe('the reauthentication dialog (AppRoot)', () => {
  it('uses the agreed wording in Korean and never claims the password changed', () => {
    const ko = getAppDictionary('ko');
    assert.equal(ko.reauthRequiredTitle, '다시 로그인이 필요합니다');
    assert.equal(ko.reauthRequiredMessage, '계정 정보가 변경되었거나 로그인 세션이 만료되어 다시 로그인이 필요합니다.');
    assert.equal(ko.reauthRequiredAction, '로그인하기');
    assert.doesNotMatch(ko.reauthRequiredMessage, /비밀번호가 변경/);
    assert.equal(getAppDictionary('en').reauthRequiredAction, 'Sign in');
  });

  it('has one action and cannot be dismissed (no close button, Escape does nothing)', () => {
    assert.match(reauthDialog, /onCancel=\{event => event\.preventDefault\(\)\}/);
    assert.equal((reauthDialog.match(/<button/g) ?? []).length, 1);
  });

  it('is rendered once for the whole app and every lost-session report opens the same one', () => {
    assert.equal((appRoot.match(/<ReauthDialog/g) ?? []).length, 1);
    assert.match(appRoot, /const requireReauthentication = useCallback\(\(\) => setReauthRequired\(true\), \[\]\);/);
    assert.match(appRoot, /const onSessionLost = requireReauthentication;/);
  });

  it('checks the session after it is ready, on visibility / focus and periodically while visible', () => {
    assert.match(appRoot, /document\.addEventListener\('visibilitychange', onVisible\)/);
    assert.match(appRoot, /window\.addEventListener\('focus', onVisible\)/);
    assert.match(appRoot, /validator\.check\(ACTIVE_CHECK_INTERVAL_MS\)/);
    assert.match(appRoot, /if \(status !== 'ready' \|\| !config\)/);
  });

  it('a lost session during the bootstrap opens the dialog instead of the generic expired notice', () => {
    assert.match(appRoot, /if \(isSessionLost\(error\)\) {\s*requireReauthentication\(\);/);
  });

  it('로그인하기 clears this tab\'s session locally, then signs in again back to the same page', () => {
    const confirm = appRoot.slice(appRoot.indexOf('const confirmReauthentication'));
    const clear = confirm.indexOf('await clearLocalSession(null)');
    const login = confirm.indexOf('msal.loginRedirect({ scopes: apiScopes(config), redirectStartPage: window.location.href })');
    assert.ok(clear > 0 && login > clear);
    assert.doesNotMatch(confirm.slice(0, login), /logoutRedirect|localStorage/);
  });
});
