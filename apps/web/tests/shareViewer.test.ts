import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDictionary, resolveLocale } from '../lib/i18n.ts';
import { planInstallCta, planSharePage } from '../lib/installCta.ts';
import { resolveClientPlatform } from '../lib/platform.ts';
import { LOCKED } from '../lib/publicApi.ts';
import { androidOpenInAppUrl, canonicalShareUrl, normalizeHost } from '../lib/shareLinks.ts';
import { buildShareMetadata, loadShareView, type ShareApi } from '../lib/shareView.ts';
import { securityHeaders } from '../lib/securityHeaders.ts';

const API = 'https://api.test';
const ID = 'AbCdEfGh12345678';

function fakeApi(overrides: Partial<ShareApi> = {}): ShareApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getCollection: async () => { calls.push('collection'); return { name: '여행', isLocked: false }; },
    getItems: async () => { calls.push('items'); return { items: [{ title: 'A', url: 'https://a.test/x', previewImageUrl: null }], nextCursor: null }; },
    ...overrides,
  };
}

describe('loadShareView', () => {
  it('a valid share is ready with the Collection name and only title / url / preview of each link', async () => {
    const api = fakeApi({
      getItems: async () => ({
        // Extra fields a future API could add must never get through.
        items: [{ title: 'A', url: 'https://a.test/x', previewImageUrl: 'https://img.test/a.jpg', memo: 'private memo', addedBy: 'Kim', id: 7, uploadedPhotoUrl: 'https://blob/secret' } as never],
        nextCursor: 'c1',
      }),
    });
    const view = await loadShareView(API, ID, undefined, api);

    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.name, '여행');
    assert.deepEqual(view.items, [{ title: 'A', url: 'https://a.test/x', previewImageUrl: 'https://img.test/a.jpg' }]);
    assert.equal(view.nextCursor, 'c1');
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /memo|addedBy|Kim|secret|"id"/);
  });

  it('an unknown or revoked share is notFound - and a revoke between the two requests is the same', async () => {
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getCollection: async () => null }))).kind, 'notFound');
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getItems: async () => null }))).kind, 'notFound');
  });

  it('a locked share is locked and its items are never requested', async () => {
    const api = fakeApi({ getCollection: async () => ({ name: null, isLocked: true }) });
    assert.equal((await loadShareView(API, ID, undefined, api)).kind, 'locked');
    assert.deepEqual(api.calls, []);
  });

  it('a grant that expires between the two requests falls back to locked', async () => {
    assert.equal((await loadShareView(API, ID, 'grant', fakeApi({ getItems: async () => LOCKED }))).kind, 'locked');
  });

  it('a backend failure is a temporary unavailable state, not a crash and not "not found"', async () => {
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getCollection: async () => { throw new Error('500'); } }))).kind, 'unavailable');
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getItems: async () => { throw new Error('timeout'); } }))).kind, 'unavailable');
  });
});

describe('loadShareView - a private link (공용 컬렉션 OFF)', () => {
  it('is only the name: the items are never requested and nothing else gets through', async () => {
    const api = fakeApi({ getCollection: async () => ({ name: '비공개', isLocked: false, isPublic: false }) });
    const view = await loadShareView(API, ID, undefined, api);

    assert.deepEqual(view, { kind: 'private', name: '비공개' });
    assert.deepEqual(api.calls, []);
  });

  it('a password-protected private link stays locked until the grant, then is still only the name', async () => {
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getCollection: async () => ({ name: null, isLocked: true }) }))).kind, 'locked');
    const view = await loadShareView(API, ID, 'grant', fakeApi({ getCollection: async () => ({ name: '비공개', isLocked: true, isPublic: false }) }));
    assert.equal(view.kind, 'private');
  });

  it('keeps the previews plain and offers the app hand-off, with no item section', () => {
    const meta = buildShareMetadata({ kind: 'private', name: '비공개' }, 'https://dev.juple.co.kr/c/x', 'desc');
    assert.equal(meta.title, 'Juple');
    assert.equal('alternates' in meta, false);
    const plan = planSharePage('private', 'android', false);
    assert.deepEqual(plan.sections, ['brand', 'title', 'cta']);
    assert.equal(plan.autoHandoff, true);
    assert.equal(planSharePage('private', 'android', true).autoHandoff, false);
  });

  it('a public link (isPublic true or absent) behaves exactly as before', async () => {
    assert.equal((await loadShareView(API, ID, undefined, fakeApi({ getCollection: async () => ({ name: '공개', isLocked: false, isPublic: true }) }))).kind, 'ready');
    assert.equal((await loadShareView(API, ID, undefined, fakeApi())).kind, 'ready');
  });
});

describe('buildShareMetadata', () => {
  const ready = { kind: 'ready', name: '내 여행', isLocked: false, items: [], nextCursor: null } as const;

  it('names a readable share, is never indexable and carries no image or item content', () => {
    const meta = buildShareMetadata(ready, 'https://dev.juple.co.kr/c/x', 'desc');
    assert.equal(meta.title, '내 여행 - Juple');
    assert.deepEqual(meta.robots, { index: false, follow: false });
    assert.equal(meta.alternates?.canonical, 'https://dev.juple.co.kr/c/x');
    assert.equal('images' in meta.openGraph, false);
    assert.equal(meta.twitter.card, 'summary');
  });

  it('a locked, unknown, revoked or failing share is a plain generic "Juple" - nothing of the share leaks', () => {
    for (const kind of ['locked', 'notFound', 'unavailable'] as const) {
      const meta = buildShareMetadata({ kind }, 'https://dev.juple.co.kr/c/x', 'desc');
      assert.equal(meta.title, 'Juple');
      assert.equal(meta.openGraph.title, 'Juple');
      assert.equal(meta.alternates, undefined);
      assert.equal('url' in meta.openGraph, false);
      assert.deepEqual(meta.robots, { index: false, follow: false });
    }
  });
});

describe('install / open links', () => {
  it('the canonical URL is the single https /c/{id} form', () => {
    assert.equal(canonicalShareUrl('dev.juple.co.kr', ID), `https://dev.juple.co.kr/c/${ID}`);
  });

  it('the Android open link targets the same canonical URL, the app package and falls back to this page - no store, no scheme', () => {
    const url = androidOpenInAppUrl('dev.juple.co.kr', ID);
    assert.match(url, /^intent:\/\/dev\.juple\.co\.kr\/c\/AbCdEfGh12345678#Intent;scheme=https;package=com\.juple\.app;/);
    // The fallback is the same page marked webonly=1, so a blocked / failed handoff can never be retried automatically.
    assert.ok(url.includes(`S.browser_fallback_url=${encodeURIComponent(`https://dev.juple.co.kr/c/${ID}?webonly=1`)}`));
    assert.ok(url.startsWith(`intent://dev.juple.co.kr/c/${ID}#`));
    assert.doesNotMatch(url, /play\.google|market:/);
  });

  it('only a plausible host is used', () => {
    assert.equal(normalizeHost('Dev.Juple.co.kr'), 'dev.juple.co.kr');
    assert.equal(normalizeHost('dev.juple.co.kr, other.test'), 'dev.juple.co.kr');
    for (const bad of [null, '', 'evil.test/path', 'a b', 'https://x.test', 'x.test?y=1', '<script>']) {
      assert.equal(normalizeHost(bad), null);
    }
  });

  it('Android: open button + Google Play only; iOS: App Store only; desktop: every configured store', () => {
    const urls = { googlePlayUrl: 'https://play.test/x', appStoreUrl: 'https://apps.test/x', hasOpenInAppUrl: true };
    assert.deepEqual(planInstallCta({ platform: 'android', ...urls }), { open: true, googlePlay: true, appStore: false, comingSoon: false });
    assert.deepEqual(planInstallCta({ platform: 'ios', ...urls }), { open: false, googlePlay: false, appStore: true, comingSoon: false });
    assert.deepEqual(planInstallCta({ platform: 'other', ...urls }), { open: false, googlePlay: true, appStore: true, comingSoon: false });
  });

  it('with no store configured (DEV) the visitor gets a plain "coming soon", never a dead button or an invented URL', () => {
    const none = { googlePlayUrl: undefined, appStoreUrl: undefined };
    assert.equal(planInstallCta({ platform: 'ios', ...none, hasOpenInAppUrl: true }).comingSoon, true);
    assert.equal(planInstallCta({ platform: 'other', ...none, hasOpenInAppUrl: true }).comingSoon, true);
    // Android still has the open-in-app button, so it is not a dead end.
    assert.deepEqual(planInstallCta({ platform: 'android', ...none, hasOpenInAppUrl: true }), { open: true, googlePlay: false, appStore: false, comingSoon: false });
  });

  it('platform sniffing', () => {
    assert.equal(resolveClientPlatform('Mozilla/5.0 (Linux; Android 14; SM-S911N)'), 'android');
    assert.equal(resolveClientPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'ios');
    assert.equal(resolveClientPlatform('Mozilla/5.0 (Windows NT 10.0)'), 'other');
    assert.equal(resolveClientPlatform(null), 'other');
  });
});

describe('web safety and copy', () => {
  it('every page is non-frameable, non-indexable, sends no referrer and sniffing is off', () => {
    const headers = new Map(securityHeaders.map(header => [header.key, header.value]));
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(headers.get('X-Frame-Options'), 'DENY');
    assert.match(headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
    assert.match(headers.get('X-Robots-Tag') ?? '', /noindex/);
  });

  it('both locales define every string, including the new ones', () => {
    const ko = getDictionary('ko');
    const en = getDictionary('en');
    assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
    for (const key of ['openInApp', 'installComingSoon', 'unavailableTitle', 'unavailableMessage', 'metaDescription'] as const) {
      assert.ok(ko[key].length > 0 && en[key].length > 0);
    }
    assert.equal(resolveLocale('ko-KR,ko;q=0.9'), 'ko');
    assert.equal(resolveLocale('fr-FR'), 'en');
  });
});

describe('Android app handoff plan', () => {
  it('a valid Android share hands off once and puts the open / install block right after the title, before the links', () => {
    const plan = planSharePage('ready', 'android', false);
    assert.equal(plan.autoHandoff, true);
    assert.deepEqual(plan.sections, ['brand', 'title', 'cta', 'items', 'footer']);
    assert.ok(plan.sections.indexOf('cta') < plan.sections.indexOf('items'));
  });

  it('a locked share also hands off (the app then applies its own lock flow) and keeps the open block above the password form', () => {
    const plan = planSharePage('locked', 'android', false);
    assert.equal(plan.autoHandoff, true);
    assert.ok(plan.sections.indexOf('cta') < plan.sections.indexOf('lockedGate'));
  });

  it('coming back from the intent fallback (webonly) never tries again - no loop', () => {
    assert.equal(planSharePage('ready', 'android', true).autoHandoff, false);
    assert.equal(planSharePage('locked', 'android', true).autoHandoff, false);
  });

  it('an invalid, revoked or failing share never launches the app', () => {
    for (const kind of ['notFound', 'unavailable'] as const) {
      assert.equal(planSharePage(kind, 'android', false).autoHandoff, false);
    }
  });

  it('desktop and iOS get no Android intent handoff', () => {
    for (const platform of ['other', 'ios'] as const) {
      assert.equal(planSharePage('ready', platform, false).autoHandoff, false);
    }
    assert.equal(planInstallCta({ platform: 'ios', googlePlayUrl: undefined, appStoreUrl: undefined, hasOpenInAppUrl: true }).open, false);
    assert.equal(planInstallCta({ platform: 'other', googlePlayUrl: undefined, appStoreUrl: undefined, hasOpenInAppUrl: true }).open, false);
  });

  it('the explicit button stays for Android, and a missing app / missing store never becomes a store redirect', () => {
    const plan = planInstallCta({ platform: 'android', googlePlayUrl: undefined, appStoreUrl: undefined, hasOpenInAppUrl: true });
    assert.deepEqual(plan, { open: true, googlePlay: false, appStore: false, comingSoon: false });
    assert.doesNotMatch(androidOpenInAppUrl('dev.juple.co.kr', ID), /play\.google|market:|apps\.apple/);
  });
});
