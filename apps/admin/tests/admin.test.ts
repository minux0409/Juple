import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AdminForbiddenError, ApiHttpError, ApiNetworkError, AuthExpiredError, checkApiHealth, createAdminApi } from '../lib/adminApi.ts';
import { ADMIN_CONFIG_ENV, knownAuthorityHosts, readAdminConfig, redirectUriFor } from '../lib/adminConfig.ts';
import {
  adminPaths,
  displayJupleId,
  failureMessage,
  INQUIRY_FILTERS,
  inquiryStatusLabel,
  localTodayStartUtc,
  manualStatusTargets,
  parseInquiryFilter,
  validateAnswer,
} from '../lib/adminModel.ts';
import { statusAfterAccessCheck, statusAfterInitialize, statusAfterPageFailure } from '../lib/adminSession.ts';
import { isActive, NAVIGATION, type NavEntry } from '../lib/navigation.ts';
import { authCallbackSecurityHeaders, contentSecurityPolicy, securityHeaders } from '../lib/securityHeaders.ts';
import { strings } from '../lib/strings.ts';
import { classifyTokenFailure } from '../lib/tokenFailure.ts';

const ENV = {
  JUPLE_ADMIN_API_BASE_URL: 'https://api.example.test/',
  JUPLE_ADMIN_ENTRA_AUTHORITY: 'https://jupletest.ciamlogin.com',
  JUPLE_ADMIN_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  JUPLE_ADMIN_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
  JUPLE_ADMIN_ENTRA_API_SCOPE: 'api://00000000-0000-0000-0000-000000000003/access_as_user',
  JUPLE_ADMIN_BASE_URL: 'https://admin.example.test/',
  JUPLE_ADMIN_BUILD_VERSION: 'admin-20261019.1',
};

function configFrom(env: Record<string, string | undefined> = ENV) {
  const result = readAdminConfig(env);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.config;
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('admin runtime config', () => {
  it('reads only its own names, normalizes slashes and derives the redirect bridge / trusted hosts', () => {
    const config = configFrom({ ...ENV, JUPLE_ENTRA_WEB_CLIENT_ID: 'the-user-web-client', SOME_SECRET: 'never-read' });
    assert.deepEqual(config, {
      apiBaseUrl: 'https://api.example.test',
      entraAuthority: 'https://jupletest.ciamlogin.com/',
      entraTenantId: ENV.JUPLE_ADMIN_ENTRA_TENANT_ID,
      entraClientId: ENV.JUPLE_ADMIN_ENTRA_CLIENT_ID,
      entraApiScope: ENV.JUPLE_ADMIN_ENTRA_API_SCOPE,
      adminBaseUrl: 'https://admin.example.test',
      buildVersion: 'admin-20261019.1',
    });
    assert.equal(redirectUriFor(config), 'https://admin.example.test/auth/callback');
    assert.deepEqual(knownAuthorityHosts(config), ['jupletest.ciamlogin.com', `${ENV.JUPLE_ADMIN_ENTRA_TENANT_ID}.ciamlogin.com`]);
  });

  it('has no defaults: a missing or malformed setting is reported by name (the API address too), the build version is optional', () => {
    assert.deepEqual(readAdminConfig({}), {
      ok: false,
      missing: [
        ADMIN_CONFIG_ENV.apiBaseUrl,
        ADMIN_CONFIG_ENV.entraAuthority,
        ADMIN_CONFIG_ENV.adminBaseUrl,
        ADMIN_CONFIG_ENV.entraTenantId,
        ADMIN_CONFIG_ENV.entraClientId,
        ADMIN_CONFIG_ENV.entraApiScope,
      ],
    });
    assert.deepEqual(readAdminConfig({ ...ENV, JUPLE_ADMIN_API_BASE_URL: 'javascript:alert(1)' }), { ok: false, missing: [ADMIN_CONFIG_ENV.apiBaseUrl] });
    assert.equal(configFrom({ ...ENV, JUPLE_ADMIN_BUILD_VERSION: undefined }).buildVersion, null);
  });

  it('never reads NEXT_PUBLIC_ variables (one image for every environment)', () => {
    for (const file of sourceFiles()) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /process\.env\.NEXT_PUBLIC_|['"]NEXT_PUBLIC_/, file);
    }
  });
});

describe('admin API client', () => {
  it('sends the bearer token to the configured API and parses JSON', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createAdminApi({
      apiBaseUrl: 'https://api.example.test',
      getAccessToken: async () => 'token-1',
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return json(200, { userId: 7, role: 'Owner' });
      },
    });
    assert.deepEqual(await api({ path: adminPaths.me }), { userId: 7, role: 'Owner' });
    assert.equal(calls[0].url, 'https://api.example.test/api/v1/admin/me');
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token-1');
    assert.equal(calls[0].init.credentials, 'omit');
  });

  it('401 -> one fresh token and one retry; a second 401 is a lost session', async () => {
    const forced: boolean[] = [];
    let status = 401;
    const api = createAdminApi({
      apiBaseUrl: 'https://api.example.test',
      getAccessToken: async ({ forceRefresh }) => {
        forced.push(forceRefresh);
        return forceRefresh ? 'fresh' : 'cached';
      },
      fetchImpl: async () => {
        const response = json(status, {});
        status = 200;
        return response;
      },
    });
    await api({ path: adminPaths.me });
    assert.deepEqual(forced, [false, true]);

    const always401 = createAdminApi({ apiBaseUrl: 'x', getAccessToken: async () => 't', fetchImpl: async () => json(401) });
    await assert.rejects(always401({ path: adminPaths.me }), AuthExpiredError);
    const noToken = createAdminApi({ apiBaseUrl: 'x', getAccessToken: async () => null, fetchImpl: async () => json(200, {}) });
    await assert.rejects(noToken({ path: adminPaths.me }), AuthExpiredError);
  });

  it('403 is "not an admin" and is not retried; network and token-source failures keep the session', async () => {
    let calls = 0;
    const forbidden = createAdminApi({
      apiBaseUrl: 'x',
      getAccessToken: async () => 't',
      fetchImpl: async () => {
        calls += 1;
        return json(403);
      },
    });
    await assert.rejects(forbidden({ path: adminPaths.me }), AdminForbiddenError);
    assert.equal(calls, 1);

    const offline = createAdminApi({ apiBaseUrl: 'x', getAccessToken: async () => 't', fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) });
    await assert.rejects(offline({ path: adminPaths.me }), ApiNetworkError);
    const tokenTimeout = createAdminApi({ apiBaseUrl: 'x', getAccessToken: async () => Promise.reject(new Error('timeout')), fetchImpl: async () => json(200) });
    await assert.rejects(tokenTimeout({ path: adminPaths.me }), ApiNetworkError);
  });

  it('a 400 carries the first validation message; other errors only their status', async () => {
    const bad = createAdminApi({
      apiBaseUrl: 'x',
      getAccessToken: async () => 't',
      fetchImpl: async () => json(400, { errors: { answer: ['answer is required.'] } }),
    });
    const error = await bad({ method: 'PUT', path: adminPaths.inquiryAnswer(1), body: { answer: '' } }).catch((e: unknown) => e);
    assert.ok(error instanceof ApiHttpError);
    assert.equal(error.validationMessage, 'answer is required.');
    assert.equal(failureMessage(error), `${strings.invalidRequest} (answer is required.)`);
    assert.equal(failureMessage(new ApiHttpError(404, null)), strings.notFound);
    assert.equal(failureMessage(new ApiHttpError(500, null)), `${strings.serverError} (500)`);
  });

  it('the health check sends no token and tells healthy / unhealthy / unreachable apart', async () => {
    let seen: RequestInit | undefined;
    assert.equal(await checkApiHealth('https://api.example.test', async (_url, init) => ((seen = init), json(200))), 'healthy');
    assert.equal((seen?.headers as Record<string, string> | undefined)?.Authorization, undefined);
    assert.equal(await checkApiHealth('x', async () => json(503)), 'unhealthy');
    assert.equal(await checkApiHealth('x', async () => Promise.reject(new TypeError('down'))), 'unreachable');
  });

  it('classifies only "sign in again" token failures as reauthRequired', () => {
    assert.equal(classifyTokenFailure({ name: 'InteractionRequiredAuthError' }), 'reauthRequired');
    assert.equal(classifyTokenFailure({ errorCode: 'invalid_grant' }), 'reauthRequired');
    assert.equal(classifyTokenFailure({ errorCode: 'no_network_connectivity' }), 'transient');
    assert.equal(classifyTokenFailure(null), 'transient');
  });
});

describe('admin session gate', () => {
  it('a signed-in account is checked with the API before anything is shown', () => {
    assert.equal(statusAfterInitialize(true), 'checking');
    assert.equal(statusAfterInitialize(false), 'signedOut');
  });

  it('only an API-confirmed Owner/Admin is ready; 403 is the forbidden screen; a lost session signs out', () => {
    assert.equal(statusAfterAccessCheck({ me: { userId: 1, role: 'Owner' } }), 'ready');
    assert.equal(statusAfterAccessCheck({ me: { userId: 1, role: 'Admin' } }), 'ready');
    assert.equal(statusAfterAccessCheck({ me: { userId: 1, role: 'Superuser' as never } }), 'failed');
    assert.equal(statusAfterAccessCheck({ error: new AdminForbiddenError() }), 'forbidden');
    assert.equal(statusAfterAccessCheck({ error: new AuthExpiredError() }), 'signedOut');
    assert.equal(statusAfterAccessCheck({ error: new ApiNetworkError() }), 'failed');
  });

  it('a grant revoked mid-session (403 on a page) leaves the admin shell at once', () => {
    assert.equal(statusAfterPageFailure(new AdminForbiddenError()), 'forbidden');
    assert.equal(statusAfterPageFailure(new AuthExpiredError()), 'signedOut');
    assert.equal(statusAfterPageFailure(new ApiHttpError(500, null)), null);
  });

  it('the forbidden screen says exactly "관리자 권한이 없습니다." and renders no navigation', () => {
    assert.equal(strings.forbidden, '관리자 권한이 없습니다.');
    const root = readFileSync(new URL('../app/(admin)/AdminRoot.tsx', import.meta.url), 'utf8');
    const forbiddenCase = root.slice(root.indexOf("case 'forbidden':"), root.indexOf("case 'failed':"));
    assert.match(forbiddenCase, /strings\.forbidden/);
    assert.doesNotMatch(forbiddenCase, /Shell|NAVIGATION|children/);
  });

  it('the app never decides admin rights itself: no role from a token, storage or the URL', () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /idTokenClaims|localStorage|roles\s*[:=]/, file);
    }
  });
});

describe('admin pages and model', () => {
  it('builds every admin path under /api/v1/admin with encoded query values', () => {
    assert.equal(adminPaths.users('@k7mp-4q8n', null), '/api/v1/admin/users?jupleId=%40k7mp-4q8n');
    assert.equal(adminPaths.inquiries('InProgress', '120'), '/api/v1/admin/support/inquiries?status=InProgress&cursor=120');
    assert.equal(adminPaths.inquiries(null, null), '/api/v1/admin/support/inquiries');
    assert.equal(adminPaths.dashboard('2026-10-18T15:00:00.000Z'), '/api/v1/admin/dashboard/summary?todayStartUtc=2026-10-18T15%3A00%3A00.000Z');
    for (const value of Object.values(adminPaths)) {
      const path = typeof value === 'string' ? value : (value as (...args: never[]) => string)(...([1, null] as never[]));
      assert.ok(path.startsWith('/api/v1/admin/'), path);
    }
  });

  it('the inquiry filters are 전체 / 접수 / 처리중 / 답변완료 and the URL value is validated', () => {
    assert.deepEqual(INQUIRY_FILTERS.map(filter => filter.label), ['전체', '접수', '처리중', '답변완료']);
    assert.equal(parseInquiryFilter('InProgress'), 'InProgress');
    assert.equal(parseInquiryFilter('2'), null);
    assert.equal(parseInquiryFilter(null), null);
    assert.equal(inquiryStatusLabel('Answered'), '답변완료');
  });

  it('status can be moved by hand only between 접수 and 처리중; an answered inquiry has no manual target', () => {
    assert.deepEqual(manualStatusTargets('Pending'), ['InProgress']);
    assert.deepEqual(manualStatusTargets('InProgress'), ['Pending']);
    assert.deepEqual(manualStatusTargets('Answered'), []);
  });

  it('validates the answer like the API (trimmed, 1..8000)', () => {
    assert.equal(validateAnswer('   '), 'empty');
    assert.equal(validateAnswer('x'.repeat(8001)), 'tooLong');
    assert.equal(validateAnswer(`  ${'x'.repeat(8000)}  `), null);
  });

  it('shows Juple IDs the way the apps do and uses the browser midnight for "today"', () => {
    assert.equal(displayJupleId('K7MP4Q8N'), '@K7MP-4Q8N');
    const now = new Date(2026, 9, 19, 13, 45);
    assert.equal(localTodayStartUtc(now), new Date(2026, 9, 19).toISOString());
  });

  it('the sidebar has every section; ones without a reliable data source are disabled, never a page', () => {
    assert.deepEqual(NAVIGATION.map(entry => entry.label), ['대시보드', '사용자', '콘텐츠', '문의', '분석', '운영']);
    const leaves = (entries: readonly NavEntry[]): NavEntry[] => entries.flatMap(entry => (entry.children ? leaves(entry.children) : [entry]));
    const enabled = leaves(NAVIGATION).filter(entry => entry.href).map(entry => entry.href);
    assert.deepEqual(enabled, ['/', '/users', '/inquiries', '/operations/app-version', '/operations/system']);
    for (const href of enabled) {
      const page = href === '/' ? 'app/(admin)/page.tsx' : `app/(admin)${href}/page.tsx`;
      assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), page);
    }
    assert.equal(isActive('/inquiries', '/inquiries/12'), true);
    assert.equal(isActive('/', '/users'), false);
  });

  it('pages have no write path except the two inquiry actions, and users / app version are read-only', () => {
    const puts = sourceFiles().filter(file => /method: 'PUT'/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(puts.map(file => file.replace(/\\/g, '/').replace(/^.*\/app\//, 'app/')), ['app/(admin)/inquiries/[inquiryId]/page.tsx']);
  });
});

describe('admin hardening', () => {
  it('every page is noindex, unframeable, no-referrer, nosniff and not cached', () => {
    const headers = Object.fromEntries(securityHeaders.map(header => [header.key, header.value]));
    assert.equal(headers['X-Robots-Tag'], 'noindex, nofollow, noarchive');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['Referrer-Policy'], 'no-referrer');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.ok(headers['Strict-Transport-Security']);
    assert.equal(authCallbackSecurityHeaders.find(header => header.key === 'X-Frame-Options')?.value, 'SAMEORIGIN');
  });

  it('the CSP lets the page talk only to itself, the configured API and Entra', () => {
    const csp = contentSecurityPolicy(configFrom(), false);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(
      csp,
      new RegExp(`connect-src 'self' https://api\\.example\\.test https://jupletest\\.ciamlogin\\.com https://${ENV.JUPLE_ADMIN_ENTRA_TENANT_ID}\\.ciamlogin\\.com(;|$)`),
    );
    assert.match(contentSecurityPolicy(configFrom(), true), /frame-ancestors 'self'/);
    assert.match(contentSecurityPolicy(null, false), /connect-src 'self'(;|$)/);
  });

  it('robots disallows everything and the layout metadata is noindex', () => {
    const robots = readFileSync(new URL('../app/robots.ts', import.meta.url), 'utf8');
    assert.match(robots, /disallow: '\/'/);
    assert.doesNotMatch(robots, /allow: \[/);
    assert.match(readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8'), /index: false, follow: false/);
  });

  it('MSAL keeps tokens in session storage and asks only for the Juple API scope', () => {
    const msal = readFileSync(new URL('../lib/msalClient.ts', import.meta.url), 'utf8');
    assert.match(msal, /BrowserCacheLocation\.SessionStorage/);
    assert.doesNotMatch(msal, /graph\.microsoft|User\.Read|console\./);
  });
});

function sourceFiles(): string[] {
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const result: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      if (name === 'node_modules' || name === '.next' || name === 'tests') continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) result.push(path);
    }
  };
  walk(decodeURIComponent(root));
  return result;
}
