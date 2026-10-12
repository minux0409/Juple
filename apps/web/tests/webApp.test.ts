import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, ApiNetworkError, AuthExpiredError, createAppApi } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  bootstrapRequestBody,
  isSessionLost,
  requiresSignIn,
  statusAfterBootstrapFailure,
  statusAfterInitialize,
} from '../lib/authSession.ts';
import { homeHistoryPath, todayWindowStartUtc } from '../lib/homeItems.ts';
import { historyLinkView, isSafeHttpUrl, type ItemHistoryEntry } from '../lib/savedLinks.ts';
import { authCallbackSecurityHeaders, securityHeaders } from '../lib/securityHeaders.ts';
import { classifySignInError, describeSignInError, signInFailureMessage } from '../lib/authErrors.ts';
import { knownAuthorityHosts, readWebAppConfig, redirectUriFor, WEB_APP_CONFIG_ENV } from '../lib/webAppConfig.ts';

const DEV_ENV = {
  JUPLE_API_BASE_URL: 'http://localhost:5092/',
  JUPLE_ENTRA_AUTHORITY: 'https://jupledev.ciamlogin.com',
  JUPLE_ENTRA_TENANT_ID: 'd2e79a05-cf5f-43ab-86d2-717e025a74b1',
  JUPLE_ENTRA_WEB_CLIENT_ID: 'd70ac03c-811e-4535-868e-9cb94d66db64',
  JUPLE_ENTRA_API_SCOPE: 'api://14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b/access_as_user',
  JUPLE_WEB_BASE_URL: 'http://localhost:3000/',
};

describe('web app runtime config', () => {
  it('reads only its public names, normalizes slashes and derives the redirect bridge / trusted hosts', () => {
    const result = readWebAppConfig({ ...DEV_ENV, SOME_SECRET: 'never-read' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.config, {
      apiBaseUrl: 'http://localhost:5092',
      entraAuthority: 'https://jupledev.ciamlogin.com/',
      entraTenantId: 'd2e79a05-cf5f-43ab-86d2-717e025a74b1',
      entraClientId: 'd70ac03c-811e-4535-868e-9cb94d66db64',
      entraApiScope: 'api://14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b/access_as_user',
      webBaseUrl: 'http://localhost:3000',
    });
    assert.equal(redirectUriFor(result.config), 'http://localhost:3000/auth/callback');
    // The name-based authority host AND the tenant's GUID-based issuer host (msal-browser 5 issuer validation).
    assert.deepEqual(knownAuthorityHosts(result.config), ['jupledev.ciamlogin.com', 'd2e79a05-cf5f-43ab-86d2-717e025a74b1.ciamlogin.com']);
    assert.deepEqual(Object.values(WEB_APP_CONFIG_ENV).sort(), Object.keys(DEV_ENV).sort());
  });

  it('names every missing sign-in value instead of guessing a tenant; the API url alone falls back to the local Backend', () => {
    const result = readWebAppConfig({ JUPLE_ENTRA_AUTHORITY: '  ' });
    assert.deepEqual(result, {
      ok: false,
      missing: ['JUPLE_ENTRA_AUTHORITY', 'JUPLE_ENTRA_TENANT_ID', 'JUPLE_ENTRA_WEB_CLIENT_ID', 'JUPLE_ENTRA_API_SCOPE', 'JUPLE_WEB_BASE_URL'],
    });
    const noApi = readWebAppConfig({ ...DEV_ENV, JUPLE_API_BASE_URL: undefined });
    assert.equal(noApi.ok && noApi.config.apiBaseUrl, 'http://localhost:5092');
  });

  it('is never configured through NEXT_PUBLIC_* (build-time inlining would break the one-image deployment)', () => {
    for (const name of Object.values(WEB_APP_CONFIG_ENV)) {
      assert.ok(!name.startsWith('NEXT_PUBLIC_'), name);
    }
  });
});

describe('authenticated API calls', () => {
  function harness(responses: Array<number | 'network'>, tokens: Array<string | null> = ['t1', 't2']) {
    const tokenCalls: boolean[] = [];
    const requests: { url: string; auth: string | null }[] = [];
    const api = createAppApi({
      apiBaseUrl: 'http://api.test',
      getAccessToken: async ({ forceRefresh }) => {
        tokenCalls.push(forceRefresh);
        return tokens[tokenCalls.length - 1] ?? null;
      },
      fetchImpl: async (input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        requests.push({ url: String(input), auth: headers.Authorization ?? null });
        const next = responses[requests.length - 1];
        if (next === 'network' || next === undefined) {
          throw new TypeError('Failed to fetch');
        }
        return new Response(next === 204 ? null : JSON.stringify({ ok: true, code: next === 409 ? 'conflictCode' : undefined }), { status: next });
      },
    });
    return { api, tokenCalls, requests };
  }

  it('sends the bearer token and returns JSON', async () => {
    const { api, requests, tokenCalls } = harness([200]);
    assert.deepEqual(await api({ path: '/api/v1/items/history' }), { ok: true });
    assert.deepEqual(requests, [{ url: 'http://api.test/api/v1/items/history', auth: 'Bearer t1' }]);
    assert.deepEqual(tokenCalls, [false]);
  });

  it('401: asks for a fresh token ONCE and retries once', async () => {
    const { api, requests, tokenCalls } = harness([401, 200]);
    assert.deepEqual(await api({ path: '/x' }), { ok: true });
    assert.deepEqual(tokenCalls, [false, true]);
    assert.deepEqual(requests.map(request => request.auth), ['Bearer t1', 'Bearer t2']);
  });

  it('401 again after the refresh is a lost session - never a retry loop', async () => {
    const { api, requests } = harness([401, 401, 200]);
    await assert.rejects(api({ path: '/x' }), AuthExpiredError);
    assert.equal(requests.length, 2);
  });

  it('no token at all (or no fresh one) is a lost session', async () => {
    await assert.rejects(harness([200], [null]).api({ path: '/x' }), AuthExpiredError);
    await assert.rejects(harness([401], ['t1', null]).api({ path: '/x' }), AuthExpiredError);
  });

  it('a network failure is NOT a lost session', async () => {
    const error = await harness(['network']).api({ path: '/x' }).catch((caught: unknown) => caught);
    assert.ok(error instanceof ApiNetworkError);
    assert.equal(isSessionLost(error), false);
  });

  it('other failures carry the status and the problem code', async () => {
    const error = await harness([409]).api({ path: '/x' }).catch((caught: unknown) => caught);
    assert.ok(error instanceof ApiHttpError);
    assert.equal(error.status, 409);
    assert.equal(error.code, 'conflictCode');
    assert.equal(isSessionLost(error), false);
  });
});

describe('session states', () => {
  it('an account goes to bootstrap, none to the landing page', () => {
    assert.equal(statusAfterInitialize(true), 'bootstrapping');
    assert.equal(statusAfterInitialize(false), 'signedOut');
  });

  it('a failed bootstrap signs out ONLY for a lost session; network / server errors keep the session with a retry', () => {
    assert.equal(statusAfterBootstrapFailure(new AuthExpiredError()), 'signedOut');
    assert.equal(statusAfterBootstrapFailure(new ApiNetworkError()), 'bootstrapFailed');
    assert.equal(statusAfterBootstrapFailure(new ApiHttpError(500, null)), 'bootstrapFailed');
  });

  it('sends the browser locale and IANA time zone to bootstrap, like the mobile app', () => {
    assert.deepEqual(bootstrapRequestBody('ko-KR', 'Asia/Seoul'), { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });
    assert.deepEqual(bootstrapRequestBody(' ', undefined), { preferredLocale: null, timeZoneId: null });
  });
});

describe('routes: the public viewer and legal pages never require sign-in', () => {
  it('only the signed-in app routes require sign-in', () => {
    for (const path of ['/', '/archive', '/collections/', '/collections/12', '/collections/12/items/34', '/items/34', '/me', '/me/settings', '/me/subscription', '/me/account', '/me/friends', '/me/trash', '/notifications']) {
      assert.equal(requiresSignIn(path), true, path);
    }
    for (const path of ['/c/AbCdEfGh12345678', '/privacy', '/terms', '/account-deletion', '/auth/callback', '/.well-known/assetlinks.json']) {
      assert.equal(requiresSignIn(path), false, path);
    }
  });

  it('the (app) route group holds only the signed-in pages; the public viewer, legal pages and the redirect bridge live outside it', () => {
    const group = new URL('../app/(app)/', import.meta.url);
    const routeDirs = readdirSync(group, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.deepEqual(routeDirs, ['@modal', 'archive', 'collections', 'items', 'me', 'notifications']);
    for (const outside of ['c/[publicId]/page.tsx', 'privacy/page.tsx', 'terms/page.tsx', 'account-deletion/page.tsx', 'auth/callback/page.tsx']) {
      assert.ok(existsSync(new URL(`../app/${outside}`, import.meta.url)), outside);
    }
  });

  it('the redirect bridge only hands the response back - no Juple API call, no signed-in app', () => {
    const bridge = readFileSync(new URL('../app/auth/callback/RedirectBridge.tsx', import.meta.url), 'utf8');
    assert.match(bridge, /broadcastResponseToMainFrame/);
    assert.doesNotMatch(bridge, /api\/v1|createAppApi|useSignedInApp|acquireToken/);
  });
});

describe('redirect bridge headers', () => {
  it('may be framed by this origin only (silent renewal); every other page stays unframeable', () => {
    const value = (headers: readonly { key: string; value: string }[], key: string) => headers.find(header => header.key === key)?.value;
    assert.equal(value(authCallbackSecurityHeaders, 'X-Frame-Options'), 'SAMEORIGIN');
    assert.match(value(authCallbackSecurityHeaders, 'Content-Security-Policy') ?? '', /frame-ancestors 'self'/);
    assert.equal(value(securityHeaders, 'X-Frame-Options'), 'DENY');
    assert.match(value(securityHeaders, 'Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
  });
});

describe('Home (오늘 저장한 링크)', () => {
  const entry = (overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry => ({
    id: 1,
    url: 'https://www.example.com/a',
    title: '  Example  ',
    memo: null,
    savedAtUtc: '2026-10-12T01:00:00Z',
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  });

  it('asks for today in the viewer\'s own time zone, newest first, one page', () => {
    const now = new Date(2026, 9, 12, 15, 30);
    assert.equal(todayWindowStartUtc(now), new Date(2026, 9, 12, 0, 0, 0, 0).toISOString());
    const path = new URL(homeHistoryPath(now), 'http://x');
    assert.equal(path.pathname, '/api/v1/items/history');
    assert.equal(path.searchParams.get('limit'), '50');
    assert.equal(path.searchParams.get('fromUtc'), todayWindowStartUtc(now));
  });

  it('shows the title (else the site), the site without www, the memo and the mobile thumbnail priority; a card opens Item Details', () => {
    assert.deepEqual(historyLinkView(entry({ memo: ' note ', coverImage: { readUrl: 'https://img.test/cover' }, previewImageUrl: 'https://img.test/preview' })), {
      id: 1,
      locked: false,
      title: { kind: 'text', text: 'Example', technical: false },
      memo: 'note',
      site: 'example.com',
      siteId: null,
      thumbnailUrl: 'https://img.test/cover',
      timestampUtc: '2026-10-12T01:00:00Z',
      href: '/items/1',
    });
    assert.deepEqual(historyLinkView(entry({ title: null })).title, { kind: 'text', text: 'example.com', technical: true });
    // Mobile resolveEffectiveThumbnailUrl: the person's own (first uploaded) photo comes BEFORE the automatic preview.
    assert.equal(historyLinkView(entry({ previewImageUrl: 'https://img.test/preview', representativeImage: { readUrl: 'https://img.test/first' } })).thumbnailUrl, 'https://img.test/first');
    assert.equal(historyLinkView(entry({ previewImageUrl: 'https://img.test/preview' })).thumbnailUrl, 'https://img.test/preview');
    assert.equal(historyLinkView(entry({ representativeImage: { readUrl: 'https://img.test/first' } })).thumbnailUrl, 'https://img.test/first');
    assert.equal(historyLinkView(entry({ previewImageUrl: 'javascript:alert(1)' })).thumbnailUrl, null);
  });

  it('a link behind a Collection lock shows nothing of itself and is not opened (a read without its Collection would skip the gate)', () => {
    const view = historyLinkView(entry({ isCollectionLocked: true, url: '', title: null, memo: 'never' }));
    assert.deepEqual(
      { locked: view.locked, title: view.title, memo: view.memo, site: view.site, thumbnailUrl: view.thumbnailUrl, href: view.href },
      { locked: true, title: { kind: 'locked' }, memo: null, site: null, thumbnailUrl: null, href: null },
    );
  });

  it('only http(s) links are ever clickable', () => {
    assert.equal(isSafeHttpUrl('https://a.test'), true);
    assert.equal(isSafeHttpUrl('http://a.test'), true);
    assert.equal(isSafeHttpUrl('javascript:alert(1)'), false);
    assert.equal(isSafeHttpUrl('not a url'), false);
    assert.equal(isSafeHttpUrl(null), false);
  });

  it('uses the mobile app\'s own wording for the empty state, both locales', () => {
    assert.equal(getAppDictionary('ko').homeEmpty, '오늘 저장한 링크가 아직 없습니다.');
    assert.equal(getAppDictionary('ko').homeTitle, '오늘 저장한 링크');
    assert.equal(getAppDictionary('en').homeEmpty, 'No links saved today yet.');
  });
});

describe('sign-in failures', () => {
  const msalError = (errorCode: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error('message with https://login.example/?secret=1'), { name: 'ClientAuthError', errorCode, correlationId: 'c-1', ...extra });

  it('a configuration problem is never shown as a transient failure (the real cause of the first Web sign-in failure)', () => {
    assert.equal(classifySignInError(msalError('endpoints_resolution_error')), 'configuration');
    assert.equal(classifySignInError(msalError('issuer_validation_failed')), 'configuration');
    assert.equal(signInFailureMessage(msalError('endpoints_resolution_error'), getAppDictionary('ko')), getAppDictionary('ko').signInConfigError);
  });

  it('a cancel says so; anything else is a retryable failure', () => {
    assert.equal(classifySignInError(msalError('user_cancelled')), 'cancelled');
    assert.equal(classifySignInError(msalError('access_denied')), 'cancelled');
    assert.equal(classifySignInError(msalError('no_network_connectivity')), 'retryable');
    assert.equal(classifySignInError(new TypeError('boom')), 'retryable');
    assert.equal(signInFailureMessage(new TypeError('boom'), getAppDictionary('ko')), '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  });

  it('the developer diagnostic is name / code / sub-error / correlation id only - never the message', () => {
    assert.deepEqual(describeSignInError(msalError('endpoints_resolution_error')), {
      name: 'ClientAuthError',
      errorCode: 'endpoints_resolution_error',
      subError: null,
      correlationId: 'c-1',
    });
    assert.ok(!JSON.stringify(describeSignInError(msalError('x'))).includes('secret'));
  });
});

describe('Collections (read-only, real data only)', async () => {
  const { COLLECTION_ICON_KEYS, COLLECTION_ICON_MARKUP, STATUS_ICON_MARKUP } = await import('../lib/collectionIconMarkup.ts');
  const { COLLECTION_FILTERS, collectionIconImage, collectionIconKey, collectionsPath, collectionTile, isCollectionLocked, isCollectionShared } = await import(
    '../lib/collectionsView.ts'
  );

  it('uses exactly the mobile app\'s icon set (generated from apps/mobile - same keys, same order), as plain SVG markup', () => {
    const mobile = readFileSync(new URL('../../mobile/src/collections/collectionIcons.ts', import.meta.url), 'utf8');
    const mobileKeys = [...(mobile.match(/COLLECTION_ICON_KEYS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]);
    assert.deepEqual([...COLLECTION_ICON_KEYS], mobileKeys);
    for (const key of COLLECTION_ICON_KEYS) {
      const markup = COLLECTION_ICON_MARKUP[key];
      assert.match(markup, /^<(path|circle|rect)\b/, key);
      // No JSX left (braces, capitalised react-native-svg tags) and nothing executable.
      assert.doesNotMatch(markup, /[{}]|<[A-Z]/, key);
      assert.doesNotMatch(markup, /script|\son[a-z]+\s*=/i, key);
    }
    for (const markup of Object.values(STATUS_ICON_MARKUP)) {
      assert.doesNotMatch(markup, /[{}]|<[A-Z]|STAR_POINTS/);
      assert.doesNotMatch(markup, /script/i);
    }
  });

  it('an unknown icon falls back to Folder - never guessed', () => {
    assert.equal(collectionIconKey('Plane'), 'Plane');
    assert.equal(collectionIconKey('SomethingNew'), 'Folder');
  });

  it('tiles: the preset pastel, a custom #RRGGBB with the mobile darkened icon, else the id-deterministic pastel', () => {
    assert.deepEqual(collectionTile('Mint', 7), { background: '#EAF5EE', icon: '#5C9878' });
    // 0xA0 0xC0 0xE0, each darkened by 72 (mobile resolveCollectionColorTile) = 0x58 0x78 0x98.
    assert.deepEqual(collectionTile('#a0c0e0', 7), { background: '#A0C0E0', icon: '#587898' });
    assert.deepEqual(collectionTile(null, 1), { background: '#FBEDEE', icon: '#B97278' });
    assert.deepEqual(collectionTile('NotAColor', 6), { background: '#EAF1FE', icon: '#5478B0' });
  });

  it('the four mobile filters, in the mobile order (즐겨찾기 first), map to the API scopes, one mobile-sized page at a time', () => {
    assert.deepEqual([...COLLECTION_FILTERS], ['favorites', 'all', 'owned', 'shared']);
    const path = new URL(collectionsPath('shared', 'next-cursor'), 'http://x');
    assert.equal(path.pathname, '/api/v1/collections');
    assert.equal(path.searchParams.get('scope'), 'shared');
    assert.equal(path.searchParams.get('limit'), '24');
    assert.equal(path.searchParams.get('cursor'), 'next-cursor');
    assert.equal(new URL(collectionsPath('all'), 'http://x').searchParams.has('cursor'), false);
  });

  it('locked / shared follow the mobile badge rules; only an http(s) icon photo is shown', () => {
    assert.equal(isCollectionLocked({ isLocked: true }), true);
    assert.equal(isCollectionLocked({}), false);
    assert.equal(isCollectionShared({ accessRole: 'viewer' }), true);
    assert.equal(isCollectionShared({ accessRole: 'owner', hasCollaborators: true }), true);
    assert.equal(isCollectionShared({ accessRole: 'owner', isPublicShareActive: true }), true);
    assert.equal(isCollectionShared({ accessRole: 'owner' }), false);
    assert.equal(collectionIconImage({ iconImageUrl: 'https://blob.test/icon.png?sig=x' }), 'https://blob.test/icon.png?sig=x');
    assert.equal(collectionIconImage({ iconImageUrl: 'javascript:alert(1)' }), null);
    assert.equal(collectionIconImage({ iconImageUrl: null }), null);
  });
});

describe('Home header and view modes', async () => {
  const { homeCountPath, todayWindowStartUtc: windowStart } = await import('../lib/homeItems.ts');
  const { parseViewMode: parseHomeViewMode } = await import('../lib/savedLinks.ts');
  const { formatMessage } = await import('../lib/appI18n.ts');

  it('counts the same window it lists (the mobile header count)', () => {
    const now = new Date(2026, 9, 12, 9, 0);
    const path = new URL(homeCountPath(now), 'http://x');
    assert.equal(path.pathname, '/api/v1/items/history/count');
    assert.equal(path.searchParams.get('fromUtc'), windowStart(now));
  });

  it('remembers only a known view mode; anything else is List', () => {
    assert.equal(parseHomeViewMode('grid'), 'grid');
    assert.equal(parseHomeViewMode('image'), 'image');
    assert.equal(parseHomeViewMode('carousel'), 'list');
    assert.equal(parseHomeViewMode(null), 'list');
  });

  it('formats the mobile header text', () => {
    assert.equal(formatMessage(getAppDictionary('ko').homeDateCount, { date: '10월 12일 (월)', count: 3 }), '10월 12일 (월) 3개');
    assert.equal(formatMessage('{missing} stays', {}), '{missing} stays');
  });
});

describe('who the signed-in person is shown as', async () => {
  const { accountLabel, formatJupleId } = await import('../lib/accountDisplay.ts');
  const ko = getAppDictionary('ko');

  it('never shows Entra\'s "unknown" placeholder - the cause of the first Web shell showing "unknown"', () => {
    assert.equal(accountLabel({ profile: null, accountName: 'unknown', accountUsername: '' }, ko.accountFallback), '계정');
    assert.equal(accountLabel({ profile: null, accountName: ' Unknown ' }, ko.accountFallback), '계정');
  });

  it('Juple\'s own identity first (the mobile 내 페이지): the nickname, else @XXXX-XXXX', () => {
    assert.equal(accountLabel({ profile: { displayName: '쥬플리', jupleId: 'ABCD2345' }, accountName: 'unknown' }, ko.accountFallback), '쥬플리');
    assert.equal(accountLabel({ profile: { displayName: null, jupleId: 'ABCD2345' }, accountName: 'unknown' }, ko.accountFallback), '@ABCD-2345');
    assert.equal(accountLabel({ profile: { displayName: '  ', jupleId: 'ABCD2345' } }, ko.accountFallback), '@ABCD-2345');
  });

  it('without the profile: the sign-in\'s real name, then its sign-in name, then 계정', () => {
    assert.equal(accountLabel({ profile: null, accountName: 'Min', accountUsername: 'min@example.test' }, ko.accountFallback), 'Min');
    assert.equal(accountLabel({ profile: null, accountName: 'unknown', accountUsername: 'min@example.test' }, ko.accountFallback), 'min@example.test');
    assert.equal(accountLabel({ profile: null }, getAppDictionary('en').accountFallback), 'Account');
  });

  it('formats the Juple ID like the mobile app', () => {
    assert.equal(formatJupleId('WNER2345'), 'WNER-2345');
    assert.equal(formatJupleId('SHORT'), 'SHORT');
  });
});

describe('보관함 (Archive)', async () => {
  const { archiveNamePagePath, archiveSectionPagePath, ARCHIVE_SECTIONS_PATH, parseArchiveSort } = await import('../lib/archiveView.ts');
  const { initialSectionKey, sectionLabel, sectionShowsDate, appendUnique } = await import('../lib/savedLinks.ts');
  const ko = getAppDictionary('ko');
  const section = (overrides: Record<string, unknown> = {}) => ({
    key: '2026-10-12',
    kind: 'today' as 'today' | 'yesterday' | 'thisWeek' | 'month',
    year: null as number | null,
    month: null as number | null,
    fromUtc: '2026-10-11T15:00:00Z',
    toUtc: null as string | null,
    count: 3,
    ...overrides,
  });

  it("시간순 reads the server sections, then an opened section's own window a page at a time", () => {
    assert.equal(ARCHIVE_SECTIONS_PATH, '/api/v1/items/history/sections');
    const first = new URL(archiveSectionPagePath(section({ kind: 'month', fromUtc: '2026-09-01T00:00:00Z', toUtc: '2026-10-01T00:00:00Z' }), null), 'http://x');
    assert.equal(first.pathname, '/api/v1/items/history');
    assert.deepEqual(Object.fromEntries(first.searchParams), { limit: '25', fromUtc: '2026-09-01T00:00:00Z', toUtc: '2026-10-01T00:00:00Z' });
    const next = new URL(archiveSectionPagePath(section(), 'opaque=='), 'http://x');
    assert.equal(next.searchParams.get('toUtc'), null);
    assert.equal(next.searchParams.get('cursor'), 'opaque==');
  });

  it("이름순 is the server's order over the whole archive, never a window", () => {
    const path = new URL(archiveNamePagePath('c1'), 'http://x');
    assert.deepEqual(Object.fromEntries(path.searchParams), { limit: '30', sort: 'name', cursor: 'c1' });
    assert.equal(parseArchiveSort('name'), 'name');
    assert.equal(parseArchiveSort('titleDesc'), 'time');
    assert.equal(parseArchiveSort(null), 'time');
  });

  it('labels and opens sections like the mobile accordion (오늘 first, else the newest)', () => {
    assert.equal(sectionLabel(section(), ko, 'ko'), '오늘');
    assert.equal(sectionLabel(section({ kind: 'thisWeek' }), ko, 'ko'), '이번 주');
    assert.equal(sectionLabel(section({ kind: 'month', key: 'month:2026-08', year: 2026, month: 8 }), ko, 'ko'), '2026년 8월');
    assert.equal(sectionLabel(section({ kind: 'month', key: 'month:2026-08' }), getAppDictionary('en'), 'en'), 'August 2026');
    assert.equal(sectionShowsDate('today'), false);
    assert.equal(sectionShowsDate('month'), true);
    assert.equal(initialSectionKey([section({ key: 'thisWeek', kind: 'thisWeek' }), section()]), '2026-10-12');
    assert.equal(initialSectionKey([section({ key: 'month:2026-08', kind: 'month' })]), 'month:2026-08');
    assert.equal(initialSectionKey([]), null);
  });

  it('a link without a picture shows its site badge only for the mobile known sites (by host, never guessed)', async () => {
    const { siteIdOf } = await import('../lib/savedLinks.ts');
    assert.equal(siteIdOf('https://m.youtube.com/watch?v=1'), 'youtube');
    assert.equal(siteIdOf('https://youtu.be/x'), 'youtube');
    assert.equal(siteIdOf('https://www.instagram.com/p/X'), 'instagram');
    assert.equal(siteIdOf('https://naver.me/abc'), 'naver');
    assert.equal(siteIdOf('https://notyoutube.com/x'), null);
    assert.equal(siteIdOf('not a url'), null);
  });

  it('a next page never repeats a link already shown', () => {
    assert.deepEqual(appendUnique([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], entry => entry.id), [{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('uses the mobile wording (empty state, Instagram labels, a locked link)', () => {
    assert.equal(ko.archiveEmpty, '저장한 링크가 아직 없습니다.');
    assert.equal(ko.instagramReel, 'Instagram 릴스');
    assert.equal(ko.lockedLink, '잠금 상태의 링크입니다.');
  });
});

describe('Collection Details', async () => {
  const details = await import('../lib/collectionDetails.ts');
  const { collectionLinkView, displayTitleOf } = await import('../lib/savedLinks.ts');
  const link = (overrides: Record<string, unknown> = {}) => ({
    itemId: 7,
    url: 'https://shop.example.com/p/1',
    title: 'Bag' as string | null,
    memo: 'mine' as string | null,
    addedAtUtc: '2026-10-10T00:00:00Z',
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  });

  it('reads the Collection, its date sections and a section page in the chosen direction', () => {
    assert.equal(details.collectionPath(12), '/api/v1/collections/12');
    assert.equal(details.collectionSectionsPath(12), '/api/v1/collections/12/items/sections');
    const page = new URL(details.collectionSectionPagePath(12, { fromUtc: 'F', toUtc: 'T' }, 'oldest', 'c'), 'http://x');
    assert.equal(page.pathname, '/api/v1/collections/12/items');
    assert.deepEqual(Object.fromEntries(page.searchParams), { limit: '25', sort: 'dateAsc', fromUtc: 'F', toUtc: 'T', cursor: 'c' });
    assert.equal(new URL(details.collectionSectionPagePath(12, { fromUtc: 'F', toUtc: null }, 'newest', null), 'http://x').searchParams.get('sort'), 'dateDesc');
  });

  it('the mobile sort chips: 시간순 flips ↓/↑, 이름순 flips ↑/↓; anything else stored is 시간순 ↓', () => {
    assert.equal(details.nextDateSort('newest'), 'oldest');
    assert.equal(details.nextDateSort('title'), 'newest');
    assert.equal(details.nextNameSort('newest'), 'title');
    assert.equal(details.nextNameSort('title'), 'titleDesc');
    assert.equal(details.parseLinkSort('titleDesc'), 'titleDesc');
    assert.equal(details.parseLinkSort('bogus'), 'newest');
  });

  it('이름순 is the mobile rule: locale-aware, numbers by value, title-less last both ways, ties newest first', () => {
    const entries = [
      link({ itemId: 1, title: 'Item 10' }),
      link({ itemId: 2, title: null, url: 'https://aaa.example' }),
      link({ itemId: 3, title: 'item 2' }),
      link({ itemId: 4, title: 'Item 2', addedAtUtc: '2026-10-11T00:00:00Z' }),
    ];
    assert.deepEqual(details.sortCollectionItemsByName(entries, 'en', 'asc').map(entry => entry.itemId), [4, 3, 1, 2]);
    assert.deepEqual(details.sortCollectionItemsByName(entries, 'en', 'desc').map(entry => entry.itemId), [1, 4, 3, 2]);
    assert.deepEqual(entries.map(entry => entry.itemId), [1, 2, 3, 4]);
  });

  it('a Collection too large for a whole-list name order stays on 시간순', () => {
    assert.equal(details.exceedsNameOrderLimit(500, false), false);
    assert.equal(details.exceedsNameOrderLimit(500, true), true);
    assert.equal(details.exceedsNameOrderLimit(501, false), true);
  });

  it("my link opens my Item Details; another member's opens the read-only shared view and never carries a memo", () => {
    assert.equal(collectionLinkView(link(), 12).href, '/items/7');
    assert.equal(collectionLinkView(link(), 12).memo, 'mine');
    const theirs = collectionLinkView(link({ isMine: false, memo: 'private' }), 12);
    assert.equal(theirs.href, '/collections/12/items/7');
    assert.equal(theirs.memo, null);
    assert.equal(collectionLinkView(link(), 12).timestampUtc, '2026-10-10T00:00:00Z');
  });

  it('a title-less Instagram post / reel gets the mobile label, never a guessed title', () => {
    assert.deepEqual(displayTitleOf(null, 'https://www.instagram.com/someone/reel/AbC_1/'), { kind: 'instagramReel' });
    assert.deepEqual(displayTitleOf('', 'https://instagram.com/p/XYZ'), { kind: 'instagramPost' });
    assert.deepEqual(displayTitleOf(null, 'https://instagram.com/someone'), { kind: 'text', text: 'instagram.com', technical: true });
  });

  it("locked / private: only the server's 403 codes are a gate; 404 is not found; anything else is a retryable failure", () => {
    assert.equal(details.contentGateOf(new ApiHttpError(403, 'collectionLocked')), 'lock');
    assert.equal(details.contentGateOf(new ApiHttpError(403, 'sharePasswordRequired')), 'sharePassword');
    assert.equal(details.contentGateOf(new ApiHttpError(403, 'subscriptionRequired')), null);
    assert.equal(details.contentGateOf(new ApiHttpError(500, 'collectionLocked')), null);
    assert.equal(details.contentGateOf(new ApiNetworkError()), null);
    assert.equal(details.isNotFound(new ApiHttpError(404, null)), true);
    assert.equal(details.isNotFound(new ApiHttpError(403, 'collectionLocked')), false);
  });
});

describe('Item Details', async () => {
  const items = await import('../lib/itemDetails.ts');
  const { parseRouteId } = await import('../lib/savedLinks.ts');

  it('reads the item, its photos and EVERY Collection it is in (scope all, paged)', () => {
    assert.equal(items.itemPath(34), '/api/v1/items/34');
    assert.equal(items.itemImagesPath(34), '/api/v1/items/34/images');
    const path = new URL(items.itemCollectionsPath(34, 'next'), 'http://x');
    assert.equal(path.pathname, '/api/v1/collections');
    assert.deepEqual(Object.fromEntries(path.searchParams), { itemId: '34', scope: 'all', limit: '50', cursor: 'next' });
    assert.equal(items.sharedItemPath(12, 34), '/api/v1/collections/12/items/34');
  });

  it('the 대표 사진: own photo (the cover, else the first), else the automatic preview, else none - http(s) only', () => {
    const own = [{ id: 1, readUrl: 'https://blob.test/1' }, { id: 2, readUrl: 'https://blob.test/2' }];
    assert.equal(items.representativePhotoUrl('https://p.test/x', own, 2), 'https://blob.test/2');
    assert.equal(items.representativePhotoUrl('https://p.test/x', own, null), 'https://blob.test/1');
    assert.equal(items.representativePhotoUrl('https://p.test/x', [], null), 'https://p.test/x');
    assert.equal(items.representativePhotoUrl(null, [], null), null);
    assert.equal(items.representativePhotoUrl('data:image/png;base64,AA', [], null), null);
  });

  it('who added a shared link: a name, else the Juple ID; a public-link add is never identified', () => {
    assert.deepEqual(items.adderLabel({ kind: 'member', jupleId: 'ABCD2345', displayName: null }), { kind: 'person', name: 'ABCD-2345' });
    assert.deepEqual(items.adderLabel({ kind: 'owner', jupleId: 'ABCD2345', displayName: '민' }), { kind: 'person', name: '민' });
    assert.deepEqual(items.adderLabel({ kind: 'publicLink', jupleId: 'ABCD2345' }), { kind: 'publicLink' });
    assert.equal(items.adderLabel({ kind: 'member' }), null);
    assert.equal(items.adderLabel(null), null);
  });

  it('an invalid route id is "not found" without asking the API', () => {
    assert.equal(parseRouteId('34'), 34);
    for (const bad of ['0', '-1', '1.5', 'abc', '', '01', '99999999999999999', undefined]) {
      assert.equal(parseRouteId(bad), null, String(bad));
    }
  });

  it('a 401 on a detail read refreshes once, then is a lost session (the same API helper as every page)', async () => {
    const forced: boolean[] = [];
    const api = createAppApi({
      apiBaseUrl: 'http://api.test',
      getAccessToken: async ({ forceRefresh }) => {
        forced.push(forceRefresh);
        return 'token';
      },
      fetchImpl: async () => new Response(null, { status: 401 }),
    });
    await assert.rejects(api({ path: items.itemPath(34) }), AuthExpiredError);
    assert.deepEqual(forced, [false, true]);
  });
});

describe('navigation: real routes for every page', () => {
  const page = (path: string) => new URL(`../app/(app)/${path}`, import.meta.url);

  it("Collection Details, Item Details and another member's link are routes (back / forward work), not modals", () => {
    for (const path of ['collections/[collectionId]/page.tsx', 'collections/[collectionId]/items/[itemId]/page.tsx', 'items/[itemId]/page.tsx', 'archive/ArchiveView.tsx']) {
      assert.ok(existsSync(page(path)), path);
    }
  });

  it('cards link to those routes; the original link opens only in a new tab without referrer / opener', () => {
    const list = readFileSync(page('SavedLinkList.tsx'), 'utf8');
    assert.match(list, /<Link className=\{className\} href=\{link\.href\}/);
    assert.doesNotMatch(list, /target="_blank"/);
    assert.match(readFileSync(page('ItemParts.tsx'), 'utf8'), /rel="noopener noreferrer" target="_blank"/);
    assert.match(readFileSync(page('collections/CollectionsView.tsx'), 'utf8'), /href=\{collectionHref\(collection\.id\)\}/);
  });

  it('the reading pages send nothing but GET (writes live only on the pages of the mobile write features)', () => {
    for (const path of ['archive/ArchiveView.tsx', 'collections/[collectionId]/items/[itemId]/SharedItemView.tsx', 'DateSections.tsx', 'HomeView.tsx', 'collections/CollectionsView.tsx']) {
      assert.doesNotMatch(readFileSync(page(path), 'utf8'), /method:\s*'(POST|PUT|PATCH|DELETE)'/, path);
    }
  });

  it('the public viewer stays anonymous and outside the signed-in app', () => {
    assert.equal(requiresSignIn('/c/AbCdEfGh12345678'), false);
    const viewer = readFileSync(new URL('../app/c/[publicId]/page.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(viewer, /useSignedInApp|createAppApi|msal/i);
  });
});

describe('fresh sign-in cancelled by the person (browser back from the Entra page)', () => {
  const msalError = (errorCode: string) => Object.assign(new Error('message with https://login.example/?secret=1'), { name: 'BrowserAuthError', errorCode });

  const calls = () => {
    const log = { clear: 0, report: [] as string[], results: [] as unknown[], ready: 0, consoleErrors: 0 };
    const original = console.error;
    return {
      log,
      actions: {
        clearMarker: () => void (log.clear += 1),
        report: (step: string) => void log.report.push(step),
        setResult: (result: unknown) => void log.results.push(result),
        backToReady: () => void (log.ready += 1),
      },
      watch: () => {
        console.error = () => void (log.consoleErrors += 1);
        return () => void (console.error = original);
      },
    };
  };

  it('user_cancelled: no report, no console.error, no failure result; the marker is cleared and the page is ready again', async () => {
    const { settleReauthenticationFailure } = await import('../lib/reauthFailure.ts');
    for (const purpose of ['passwordReset', 'collectionLockSetup', 'collectionLockReset', 'deleteAccount'] as const) {
      const harness = calls();
      const restore = harness.watch();
      const outcome = settleReauthenticationFailure(msalError('user_cancelled'), purpose, harness.actions);
      restore();
      assert.equal(outcome, 'cancelled', purpose);
      assert.deepEqual(harness.log, { clear: 1, report: [], results: [], ready: 1, consoleErrors: 0 }, purpose);
    }
  });

  it('a real auth error keeps its report and the incomplete outcome (no marker is silently dropped as a cancel)', async () => {
    const { settleReauthenticationFailure } = await import('../lib/reauthFailure.ts');
    for (const code of ['interaction_in_progress', 'invalid_request', 'access_denied', 'network_error']) {
      const harness = calls();
      const outcome = settleReauthenticationFailure(msalError(code), 'passwordReset', harness.actions);
      assert.equal(outcome, 'failed', code);
      assert.deepEqual(harness.log.report, ['reauthenticate'], code);
      assert.deepEqual(harness.log.results, [{ purpose: 'passwordReset', outcome: 'incomplete' }], code);
      assert.equal(harness.log.clear, 0, code);
      assert.equal(harness.log.ready, 1, code);
    }
    const harness = calls();
    settleReauthenticationFailure(new Error('boom'), 'deleteAccount', harness.actions);
    assert.deepEqual(harness.log.report, ['reauthenticate']);
  });

  it('only the exact code user_cancelled is the expected cancellation', async () => {
    const { isUserCancelled } = await import('../lib/reauthFailure.ts');
    assert.equal(isUserCancelled(msalError('user_cancelled')), true);
    assert.equal(isUserCancelled(msalError('access_denied')), false);
    assert.equal(isUserCancelled(new Error('user_cancelled')), false, 'a message is not a code');
    assert.equal(isUserCancelled(null), false);
  });

  it('AppRoot routes every fresh sign-in (one place) through it: the session stays and the marker helper is the real sessionStorage one', () => {
    const root = readFileSync(new URL('../app/(app)/AppRoot.tsx', import.meta.url), 'utf8');
    assert.match(root, /settleReauthenticationFailure\(error, purpose, \{\s*clearMarker: clearPendingReauthentication,\s*report: reportSignInError,/);
    const body = root.slice(root.indexOf('const reauthenticate = useCallback'), root.indexOf('const onSessionLost'));
    assert.doesNotMatch(body, /signOut|clearLocalSession|setAccount/, 'a cancelled fresh sign-in never ends the session');
    const msalSource = readFileSync(new URL('../lib/msalClient.ts', import.meta.url), 'utf8');
    assert.match(msalSource, /export function clearPendingReauthentication\(\): void \{\s*try \{\s*window\.sessionStorage\.removeItem\(PENDING_REAUTH_KEY\);/);
    // Every fresh sign-in (비밀번호 재설정, 컬렉션 잠금 설정 / 재설정, 계정 삭제) goes through reauthenticate(purpose).
    for (const [file, call] of [['me/MyPageSections.tsx', "reauthenticate('passwordReset')"], ['me/collection-lock/page.tsx', 'reauthenticate('], ['me/account/delete/page.tsx', "reauthenticate('deleteAccount')"]] as const) {
      assert.ok(readFileSync(new URL(`../app/(app)/${file}`, import.meta.url), 'utf8').includes(call), file);
    }
  });
});

describe('API call timing (development measurement)', () => {
  it('splits a call into token / wait / body and reports only the path and the parameter NAMES', async () => {
    let clock = 0;
    const timings: import('../lib/appApi.ts').ApiTiming[] = [];
    const api = createAppApi({
      apiBaseUrl: 'https://api.example.test',
      getAccessToken: async () => {
        clock += 5;
        return 'secret-token';
      },
      fetchImpl: async () => {
        clock += 120;
        const response = new Response(JSON.stringify({ items: [] }), { status: 200 });
        const original = response.json.bind(response);
        response.json = async () => {
          clock += 30;
          return original();
        };
        return response;
      },
      now: () => clock,
      onTiming: timing => void timings.push(timing),
    });
    await api({ path: '/api/v1/items/history?limit=30&sort=name&q=my%20private%20search' });
    assert.equal(timings.length, 1);
    assert.deepEqual(timings[0], { method: 'GET', path: '/api/v1/items/history', queryKeys: ['limit', 'sort', 'q'], status: 200, tokenMs: 5, waitMs: 120, bodyMs: 30, totalMs: 155 });
    assert.doesNotMatch(JSON.stringify(timings), /secret-token|private|search/);
  });

  it('measures nothing without a listener, and a refused call is reported with its status', async () => {
    const quiet = createAppApi({ apiBaseUrl: 'https://api.example.test', getAccessToken: async () => 't', fetchImpl: async () => new Response('{}', { status: 200 }) });
    assert.deepEqual(await quiet({ path: '/x' }), {});
    const seen: Array<number | null> = [];
    const refused = createAppApi({
      apiBaseUrl: 'https://api.example.test',
      getAccessToken: async () => 't',
      fetchImpl: async () => new Response('{"code":"nope"}', { status: 409 }),
      onTiming: timing => void seen.push(timing.status),
    });
    await assert.rejects(refused({ path: '/x' }), ApiHttpError);
    assert.deepEqual(seen, [409]);
    assert.match(readFileSync(new URL('../app/(app)/AppRoot.tsx', import.meta.url), 'utf8'), /process\.env\.NODE_ENV !== 'production'\s*\?\s*timing =>/);
  });
});
