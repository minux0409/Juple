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
  policyView,
  safeStoreUrl,
  validateAnswer,
} from '../lib/adminModel.ts';
import { statusAfterAccessCheck, statusAfterInitialize, statusAfterPageFailure } from '../lib/adminSession.ts';
import { activeHref, isActive, NAVIGATION, type NavEntry } from '../lib/navigation.ts';
import {
  activeSeries,
  analyticsPath,
  chartDataRows,
  formatValue,
  NO_DATA_TEXT,
  userLinkStatsPath,
  valueLabelsFit,
  bucketLabel,
  holdingRows,
  membershipRows,
  percentOf,
  labelIndexes,
  layoutBars,
  niceMax,
  parseRange,
  platformShares,
  savesPerSaver,
  shortDay,
  trackingCoverage,
  type AnalyticsDay,
} from '../lib/analytics.ts';
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

  it('in production (the container) accepts only https, never a local host; ids must be GUIDs and the scope access_as_user', () => {
    const production = (env: Record<string, string | undefined>) => readAdminConfig(env, true);
    assert.equal(production(ENV).ok, true);
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_API_BASE_URL: 'http://api.example.test' }), { ok: false, missing: [ADMIN_CONFIG_ENV.apiBaseUrl] });
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_BASE_URL: 'https://localhost:3100' }), { ok: false, missing: [ADMIN_CONFIG_ENV.adminBaseUrl] });
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_ENTRA_AUTHORITY: 'https://127.0.0.1' }), { ok: false, missing: [ADMIN_CONFIG_ENV.entraAuthority] });
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_ENTRA_CLIENT_ID: 'not-a-guid' }), { ok: false, missing: [ADMIN_CONFIG_ENV.entraClientId] });
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_ENTRA_TENANT_ID: 'juple' }), { ok: false, missing: [ADMIN_CONFIG_ENV.entraTenantId] });
    assert.deepEqual(production({ ...ENV, JUPLE_ADMIN_ENTRA_API_SCOPE: 'api://x/User.Read' }), { ok: false, missing: [ADMIN_CONFIG_ENV.entraApiScope] });
    // `next dev` may run against a local API.
    assert.equal(readAdminConfig({ ...ENV, JUPLE_ADMIN_API_BASE_URL: 'http://localhost:5092', JUPLE_ADMIN_BASE_URL: 'http://localhost:3100' }, false).ok, true);
  });

  it('has a /health probe that needs no sign-in, API or configuration', async () => {
    const { GET } = await import('../app/health/route.ts');
    const response = GET();
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
    const source = readFileSync(new URL('../app/health/route.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /process\.env|fetch\(|adminConfig/);
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

  it('app version: the Production answer shows Android 31 / 24 with its store URL and iOS as not configured', () => {
    // The exact JSON GET /api/v1/admin/operations/app-version returns in Production (AdminAuthorizationPipelineTests pins it).
    const production = JSON.parse(
      '{"android":{"platform":"android","enabled":true,"latestBuild":31,"minimumSupportedBuild":24,"storeUrl":"https://play.google.com/store/apps/details?id=com.juple.app"},"ios":{"platform":"ios","enabled":false,"latestBuild":0,"minimumSupportedBuild":0,"storeUrl":null}}',
    );
    assert.deepEqual(policyView(production.android), {
      kind: 'configured',
      latestBuild: 31,
      minimumSupportedBuild: 24,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.juple.app',
    });
    assert.deepEqual(policyView(production.ios), { kind: 'notConfigured' });
  });

  it('app version: a missing or malformed policy is "unreadable", never invented numbers; only https store URLs are links', () => {
    assert.deepEqual(policyView(undefined), { kind: 'unreadable' });
    assert.deepEqual(policyView({ enabled: true, latestBuild: '31', minimumSupportedBuild: 24 }), { kind: 'unreadable' });
    assert.deepEqual(policyView({ Enabled: true, LatestBuild: 31, MinimumSupportedBuild: 24 }), { kind: 'unreadable' });
    assert.deepEqual(policyView({ enabled: true, latestBuild: 31, minimumSupportedBuild: 24, storeUrl: null }), {
      kind: 'configured',
      latestBuild: 31,
      minimumSupportedBuild: 24,
      storeUrl: null,
    });
    assert.equal(safeStoreUrl('javascript:alert(1)'), null);
    assert.equal(safeStoreUrl('http://play.google.com/x'), null);
    const long = `https://play.google.com/store/apps/details?id=com.juple.app&${'x'.repeat(400)}`;
    assert.equal(safeStoreUrl(long), long);
  });

  it('app version page: values stay inside each card (no max-content label column) and go through policyView', () => {
    const page = readFileSync(new URL('../app/(admin)/operations/app-version/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /policyView\(raw\)/);
    assert.match(page, /strings\.policyNotConfigured/);
    assert.match(page, /rel="noopener noreferrer"/);
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    assert.doesNotMatch(css, /grid-template-columns:\s*max-content\s+1fr/);
    assert.match(css, /\.policy-rows dd\.policy-url \{[^}]*overflow-wrap: anywhere/);
    assert.equal(strings.policyNotConfigured, '정책 미설정');
  });

  it('shows Juple IDs the way the apps do and uses the browser midnight for "today"', () => {
    assert.equal(displayJupleId('K7MP4Q8N'), '@K7MP-4Q8N');
    const now = new Date(2026, 9, 19, 13, 45);
    assert.equal(localTodayStartUtc(now), new Date(2026, 9, 19).toISOString());
  });

  it('the sidebar has every section; 콘텐츠 (no decided scope) stays disabled, every enabled entry is a real page', () => {
    assert.deepEqual(NAVIGATION.map(entry => entry.label), ['Overview', 'Users', 'Links', '콘텐츠', '공지사항 관리', '문의', 'Business Expenses', 'Revenue & Profit', 'Settings', '기존 UTC 분석', 'Operations']);
    const leaves = (entries: readonly NavEntry[]): NavEntry[] => entries.flatMap(entry => (entry.children ? leaves(entry.children) : [entry]));
    const enabled = leaves(NAVIGATION).filter(entry => entry.href).map(entry => entry.href);
    assert.deepEqual(enabled, [
      '/',
      '/workspace/users',
      '/users',
      '/links',
      '/notices',
      '/inquiries',
      '/expenses',
      '/revenue',
      '/settings',
      '/analytics',
      '/analytics/users',
      '/analytics/saves',
      '/analytics/countries',
      '/analytics/platforms',
      '/operations/app-version',
      '/operations/system',
    ]);
    assert.deepEqual(leaves(NAVIGATION.find(entry => entry.label === '콘텐츠')!.children!).map(entry => entry.href), [null, null]);
    assert.equal(activeHref('/analytics/users'), '/analytics/users');
    assert.equal(activeHref('/analytics'), '/analytics');
    assert.equal(activeHref('/inquiries/12'), '/inquiries');
    for (const href of enabled) {
      const page = href === '/' ? 'app/(admin)/page.tsx' : `app/(admin)${href}/page.tsx`;
      assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), page);
    }
    assert.equal(isActive('/inquiries', '/inquiries/12'), true);
    assert.equal(isActive('/', '/users'), false);
  });

  it('existing user, analytics and app-version pages stay read-only; ledger has its own controlled writes', () => {
    const puts = sourceFiles().filter(file => /method: 'PUT'/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(puts.map(file => file.replace(/\\/g, '/').replace(/^.*\/app\//, 'app/')), ['app/(admin)/inquiries/[inquiryId]/page.tsx']);
  });
});

describe('analytics', () => {
  const day = (date: string, activeUsers = 0): AnalyticsDay => ({ date, signups: 0, activeUsers, linksSaved: 0, collectionsCreated: 0 });

  it('ranges are 7d / 30d / 90d; anything else falls back to 30d (the API refuses it with 400 anyway)', () => {
    assert.deepEqual(['7d', '30d', '90d', 'x', null, '30D'].map(value => parseRange(value)), ['7d', '30d', '90d', '30d', '30d', '30d']);
    assert.equal(analyticsPath('90d'), '/api/v1/admin/analytics/overview?range=90d');
  });

  it('the tracking-start notice: none before any activity, partial while the window starts before tracking, full afterwards', () => {
    assert.deepEqual(trackingCoverage(null, '2026-09-20'), { kind: 'none' });
    assert.deepEqual(trackingCoverage('2026-10-19', '2026-09-20'), { kind: 'partial', since: '2026-10-19' });
    assert.deepEqual(trackingCoverage('2026-09-20', '2026-09-20'), { kind: 'full' });
    assert.deepEqual(trackingCoverage('2026-08-01', '2026-09-20'), { kind: 'full' });
  });

  it('days before tracking started are "no data" (null), never 0; from the start day on they are real counts', () => {
    const series = [day('2026-10-17'), day('2026-10-18'), day('2026-10-19', 3)];
    assert.deepEqual(activeSeries(series, '2026-10-18'), [null, 0, 3]);
    assert.deepEqual(activeSeries(series, null), [null, null, null]);
  });

  it('platforms: Android / iOS / Web always (0 as 0), Unknown only when present, shares of the distinct total', () => {
    assert.deepEqual(platformShares({ activeUsersInRange: 0, items: [] }), [
      { platform: 'Android', activeUsers: 0, percent: 0 },
      { platform: 'Ios', activeUsers: 0, percent: 0 },
      { platform: 'Web', activeUsers: 0, percent: 0 },
    ]);
    // One person on Android and Web: both 100% of the 1 distinct user.
    const shares = platformShares({ activeUsersInRange: 3, items: [{ platform: 'Android', activeUsers: 2 }, { platform: 'Web', activeUsers: 1 }, { platform: 'Unknown', activeUsers: 1 }] });
    assert.deepEqual(shares.map(share => [share.platform, share.activeUsers, share.percent]), [['Android', 2, 66.7], ['Ios', 0, 0], ['Web', 1, 33.3], ['Unknown', 1, 33.3]]);
  });

  it('chart geometry: nice axis maximum, bars inside the plot, null days without a bar', () => {
    assert.deepEqual([0, 1, 3, 7, 12, 99, 101].map(niceMax), [1, 1, 5, 10, 20, 100, 200]);
    const layout = layoutBars([0, 5, null, 10], ['a', 'b', 'c', 'd'], 400, 100);
    assert.equal(layout.max, 10);
    assert.deepEqual(layout.bars.map(bar => [bar.value, Math.round(bar.height)]), [[0, 0], [5, 50], [null, 0], [10, 100]]);
    for (const bar of layout.bars) {
      assert.ok(bar.x >= 0 && bar.x + bar.width <= 400 && bar.y >= 0 && bar.y + bar.height <= 100);
    }
    assert.deepEqual(layout.ticks.map(tick => tick.value), [0, 5, 10]);
    // Counts never get a fractional grid line (max 5 -> 0 and 5 only).
    assert.deepEqual(layoutBars([4], ['a'], 100, 100).ticks.map(tick => tick.value), [0, 5]);
    // Date labels: about 8, the last (today) always, none crowding it.
    assert.deepEqual(labelIndexes(30), [0, 4, 8, 12, 16, 20, 24, 29]);
    assert.deepEqual(labelIndexes(7), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(labelIndexes(90).at(-1), 89);
    assert.ok(89 - labelIndexes(90).at(-2)! >= 7);
    assert.equal(layoutBars(new Array(90).fill(1), new Array(90).fill(''), 600, 160).bars.length, 90);
    assert.equal(shortDay('2026-10-09'), '10/9');
    assert.equal(savesPerSaver(7, 3), 2.3);
    assert.equal(savesPerSaver(0, 0), null);
  });

  it('exact values: unit written, 0 is a real zero, missing data is never 0, integers only', () => {
    assert.equal(formatValue(0, '개'), '0개');
    assert.equal(formatValue(1234, '명'), (1234).toLocaleString() + '명');
    assert.equal(formatValue(null, '명'), NO_DATA_TEXT);
    assert.ok(!formatValue(7, '개').includes('.'));
    const rows = chartDataRows(['2026-10-01', '2026-10-02', 'a-very-long-label-2026-10-03-extra'], [0, null, 12], '개');
    assert.deepEqual(rows.map(row => [row.text, row.noData]), [['0개', false], [NO_DATA_TEXT, true], ['12개', false]]);
    assert.equal(rows[2]!.label, 'a-very-long-label-2026-10-03-extra'); // long labels are carried whole, never cut
    assert.equal(chartDataRows([], [], '명').length, 0);
  });

  it('value labels on the bars only when none can touch its neighbour; otherwise the data list carries the values', () => {
    assert.equal(valueLabelsFit(new Array(7).fill(5), 600), true);
    assert.equal(valueLabelsFit(new Array(30).fill(99), 600), true); // 20 units per bar, 2 digits
    assert.equal(valueLabelsFit(new Array(90).fill(5), 600), false); // 6.7 units per bar
    assert.equal(valueLabelsFit(new Array(30).fill(123456), 600), false); // wide numbers
    assert.equal(valueLabelsFit([], 600), true);
    assert.equal(valueLabelsFit([null, null], 600), true);
  });

  it('per-user link statistics: path is numeric-only and range-scoped; the page and strings never touch link content', () => {
    assert.equal(userLinkStatsPath(42, '7d'), '/api/v1/admin/users/42/link-stats?range=7d');
    const page = readFileSync(join(import.meta.dirname, '..', 'app', '(admin)', 'users', '[userId]', 'page.tsx'), 'utf8');
    assert.ok(!/[^a-z](?:data|day)[.](?:url|title|memo|previewImage|imageUrl)[^a-z]/i.test(page));
    assert.ok(page.includes('parseId'));
  });

  it('every chart and share list in the Admin names its unit (명 / 개)', () => {
    const root = join(import.meta.dirname, '..', 'app');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('page.tsx')) files.push(full);
      }
    };
    walk(root);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const uses = source.split('<BarChart').length + source.split('<ShareList').length - 2;
      const units = (source.match(/unit=(?:"(?:명|개)"|\{total.currency\}|\{currency\})/g) ?? []).length;
      assert.equal(units, uses, `${file}: ${uses} chart / share list uses, ${units} units`);
    }
    assert.ok(files.length > 5);
  });

  it('membership: no trial / paid numbers while the billing program does not run; exclusive groups adding up when it does', () => {
    const base = { programStartAtUtc: null, totalUsers: 20, newToday: 1, signedUpWithin30Days: 3, signedUpOver30Days: 17 };
    assert.equal(membershipRows({ ...base, billingProgramEnabled: false, groups: null }), null);
    // Even a stray groups object is ignored while the program is off.
    assert.equal(membershipRows({ ...base, billingProgramEnabled: false, groups: { paid: 0, gracePeriod: 0, inTrial: 0, trialEndedUnpaid: 0 } }), null);
    const rows = membershipRows({ ...base, billingProgramEnabled: true, programStartAtUtc: '2026-11-01T00:00:00Z', groups: { paid: 2, gracePeriod: 1, inTrial: 5, trialEndedUnpaid: 12 } })!;
    assert.deepEqual(rows.map(row => [row.key, row.value, row.percent]), [['paid', 2, 10], ['gracePeriod', 1, 5], ['inTrial', 5, 25], ['trialEndedUnpaid', 12, 60]]);
    assert.equal(rows.reduce((sum, row) => sum + row.value, 0), 20);
    assert.match(strings.membershipNotLaunched, /결제 미운영 · 집계 불가/);
    assert.match(strings.membershipAgeNote, /체험·결제 상태가 아닙니다/);
  });

  it('link holdings: bucket labels, shares over every account, and no URL or content anywhere in the model', () => {
    assert.deepEqual([{ min: 0, max: 0 }, { min: 1, max: 9 }, { min: 500, max: null }].map(bucketLabel), ['0개', '1~9개', '500개 이상']);
    const holdings = {
      totalLiveLinks: 120, usersWithLinks: 4, totalUsers: 10, maxLinksPerUser: 60, usersAtMax: 1,
      buckets: [{ min: 0, max: 0, users: 6 }, { min: 1, max: 9, users: 2 }, { min: 10, max: 49, users: 1 }, { min: 50, max: 99, users: 1 }, { min: 100, max: 499, users: 0 }, { min: 500, max: null, users: 0 }],
      topHolders: [{ jupleId: 'QZAMQBQK', liveLinks: 60 }],
    };
    assert.deepEqual(holdingRows(holdings).map(row => [row.key, row.value, row.percent]), [['0개', 6, 60], ['1~9개', 2, 20], ['10~49개', 1, 10], ['50~99개', 1, 10], ['100~499개', 0, 0], ['500개 이상', 0, 0]]);
    assert.equal(percentOf(3, 0), 0);
    const saves = readFileSync(new URL('../app/(admin)/analytics/saves/page.tsx', import.meta.url), 'utf8');
    assert.match(saves, /strings\.holdingsNote/);
    assert.match(saves, /strings\.savesActivityTitle/);
    assert.doesNotMatch(saves, /\.url\b|\.title\b|memo/i);
  });

  it('every analytics page uses the shared frame, and the country page invents no numbers', () => {
    for (const page of ['analytics/page.tsx', 'analytics/users/page.tsx', 'analytics/saves/page.tsx', 'analytics/platforms/page.tsx', 'analytics/countries/page.tsx']) {
      const source = readFileSync(new URL(`../app/(admin)/${page}`, import.meta.url), 'utf8');
      assert.match(source, /<AnalyticsFrame/, page);
      assert.match(source, /<Suspense/, page);
    }
    const countries = readFileSync(new URL('../app/(admin)/analytics/countries/page.tsx', import.meta.url), 'utf8');
    assert.match(countries, /strings\.countriesNotCollected/);
    assert.doesNotMatch(countries, /locale|timeZone|language/i);
    assert.equal(strings.countriesNotCollected, '국가 데이터 수집을 아직 시작하지 않았습니다.');
    const parts = readFileSync(new URL('../app/(admin)/analytics/AnalyticsParts.tsx', import.meta.url), 'utf8');
    assert.match(parts, /role="img"/);
    assert.match(parts, /<title>/);
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
