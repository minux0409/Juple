import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, ApiNetworkError, AuthExpiredError, createAppApi } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appI18n.ts';
import {
  bootstrapRequestBody,
  isSessionLost,
  requiresSignIn,
  statusAfterBootstrapFailure,
  statusAfterInitialize,
} from '../lib/authSession.ts';
import { homeHistoryPath, isSafeHttpUrl, todayWindowStartUtc, toHomeLinkView, type ItemHistoryEntry } from '../lib/homeItems.ts';
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
    for (const path of ['/', '/archive', '/collections/', '/me']) {
      assert.equal(requiresSignIn(path), true, path);
    }
    for (const path of ['/c/AbCdEfGh12345678', '/privacy', '/terms', '/account-deletion', '/auth/callback', '/.well-known/assetlinks.json']) {
      assert.equal(requiresSignIn(path), false, path);
    }
  });

  it('the (app) route group holds only the signed-in pages; the public viewer, legal pages and the redirect bridge live outside it', () => {
    const group = new URL('../app/(app)/', import.meta.url);
    const routeDirs = readdirSync(group, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    assert.deepEqual(routeDirs, ['archive', 'collections', 'me']);
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

  it('shows the title (else the site), the site without www and the mobile thumbnail priority', () => {
    assert.deepEqual(toHomeLinkView(entry({ coverImage: { readUrl: 'https://img/cover' }, previewImageUrl: 'https://img/preview' })), {
      id: 1,
      locked: false,
      title: 'Example',
      site: 'example.com',
      url: 'https://www.example.com/a',
      thumbnailUrl: 'https://img/cover',
      savedAtUtc: '2026-10-12T01:00:00Z',
    });
    assert.equal(toHomeLinkView(entry({ title: null })).title, 'example.com');
    assert.equal(toHomeLinkView(entry({ previewImageUrl: 'https://img/preview', representativeImage: { readUrl: 'https://img/first' } })).thumbnailUrl, 'https://img/preview');
    assert.equal(toHomeLinkView(entry({ representativeImage: { readUrl: 'https://img/first' } })).thumbnailUrl, 'https://img/first');
  });

  it('a link behind a Collection lock shows nothing of itself', () => {
    const view = toHomeLinkView(entry({ isCollectionLocked: true, url: '', title: null }));
    assert.deepEqual({ locked: view.locked, title: view.title, site: view.site, url: view.url, thumbnailUrl: view.thumbnailUrl }, {
      locked: true,
      title: null,
      site: null,
      url: null,
      thumbnailUrl: null,
    });
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

  it('the four mobile filters map to the API scopes, one mobile-sized page at a time', () => {
    assert.deepEqual([...COLLECTION_FILTERS], ['all', 'favorites', 'owned', 'shared']);
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
  const { homeCountPath, parseHomeViewMode, todayWindowStartUtc: windowStart } = await import('../lib/homeItems.ts');
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
