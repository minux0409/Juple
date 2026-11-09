import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { RENEWAL_STRINGS } from '../lib/appDictionaryRenewal.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { storeConfig } from '../lib/storeConfig.ts';
import { planInstallCta } from '../lib/installCta.ts';
import { DEFAULT_APP_STORE_URL, DEFAULT_GOOGLE_PLAY_URL, membershipStoreLinks, resolveAppDownload } from '../lib/appDownload.ts';

const root = join(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.next', 'tests', 'out', 'coverage']);

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.d.ts')) found.push(full);
  }
  return found;
}

describe('Web membership policy: subscriptions are bought only in the mobile apps', () => {
  it('no Web code starts a purchase, checkout, restore or store billing call', () => {
    const forbidden = /stripe|paypal|checkout|\/api\/v1\/billing|react-native-iap|storekit|play-billing|requestPurchase|requestSubscription|finishTransaction|restorePurchases|purchaseToken/i;
    const offenders = sources(root).filter(file => forbidden.test(readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')));
    assert.deepEqual(offenders.map(file => file.slice(root.length + 1)), []);
  });

  it('no payment package is a Web dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.deepEqual(names.filter(name => /stripe|paypal|iap|billing|payment/i.test(name)), []);
  });

  it('the official store links are the defaults, and a phone sees only its own store', () => {
    assert.equal(DEFAULT_APP_STORE_URL, 'https://apps.apple.com/kr/app/id6826603114');
    assert.equal(DEFAULT_GOOGLE_PLAY_URL, 'https://play.google.com/store/apps/details?id=com.juple.app');
    const download = resolveAppDownload({});
    assert.deepEqual(membershipStoreLinks('android', download), { googlePlay: DEFAULT_GOOGLE_PLAY_URL, appStore: null });
    assert.deepEqual(membershipStoreLinks('ios', download), { googlePlay: null, appStore: DEFAULT_APP_STORE_URL });
    assert.deepEqual(membershipStoreLinks('other', download), { googlePlay: DEFAULT_GOOGLE_PLAY_URL, appStore: DEFAULT_APP_STORE_URL });
  });

  it('the "subscribe in the mobile app" message exists in all 17 languages', () => {
    assert.equal(APP_LANGUAGES.length, 17);
    for (const language of APP_LANGUAGES) {
      assert.ok(RENEWAL_STRINGS[language].membershipGetInApp.trim().length > 0, language);
    }
    assert.equal(RENEWAL_STRINGS.ko.membershipGetInApp, 'Juple 멤버십은 모바일 앱에서 구독할 수 있어요.');
  });

  it('a non-subscriber sees the message and only plain store links; a subscriber is sent to the store that owns the subscription', () => {
    const page = readFileSync(join(root, 'app', '(app)', 'me', 'MyPageSections.tsx'), 'utf8');
    assert.match(page, /data-membership-get-app/);
    assert.match(page, /dictionary\.membershipGetInApp/);
    assert.match(page, /href=\{stores\.googlePlay\}/);
    assert.match(page, /href=\{stores\.appStore\}/);
    assert.match(page, /subscribedOnPlay = storeSubscription\?\.platform === 'google'/);
    assert.match(page, /subscribedOnAppStore = storeSubscription\?\.platform === 'apple'/);
    assert.match(page, /subscribedUnknownStore/);
    // the store links are anchors, never a button / form / fetch of ours
    const prompt = page.slice(page.indexOf('data-membership-get-app'), page.indexOf('data-membership-plans'));
    assert.doesNotMatch(prompt, /<button|<form|fetch\(|api\(|request\(/);
  });

  it('environment overrides are https-only; dangerous or malformed values fall back to the official listings', () => {
    assert.equal(resolveAppDownload({ appStoreUrl: ' https://apps.apple.com/app/id1 ' }).appStoreUrl, 'https://apps.apple.com/app/id1');
    assert.equal(resolveAppDownload({ googlePlayUrl: 'https://play.test/x' }).googlePlayUrl, 'https://play.test/x');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://apps.apple.com/x', 'itms-apps://x', '//evil.test', 'apps.apple.com/x', '', '   ']) {
      assert.equal(resolveAppDownload({ appStoreUrl: bad, googlePlayUrl: bad }).appStoreUrl, DEFAULT_APP_STORE_URL, bad);
      assert.equal(resolveAppDownload({ appStoreUrl: bad, googlePlayUrl: bad }).googlePlayUrl, DEFAULT_GOOGLE_PLAY_URL, bad);
    }
  });

  it('the public share page uses the same source: official App Store by default, per-visitor store choice unchanged', () => {
    assert.equal(storeConfig.appStoreUrl, resolveAppDownload({ appStoreUrl: process.env.APP_STORE_URL }).appStoreUrl);
    assert.match(storeConfig.appStoreUrl ?? '', /^https:\/\//);
    const config = readFileSync(join(root, 'lib', 'storeConfig.ts'), 'utf8');
    assert.match(config, /appStoreUrl: resolveAppDownload\(\{ appStoreUrl: process\.env\.APP_STORE_URL \}\)\.appStoreUrl/);
    const urls = { googlePlayUrl: DEFAULT_GOOGLE_PLAY_URL, appStoreUrl: DEFAULT_APP_STORE_URL, hasOpenInAppUrl: true };
    assert.deepEqual(planInstallCta({ platform: 'ios', ...urls }), { open: false, googlePlay: false, appStore: true, comingSoon: false });
    assert.deepEqual(planInstallCta({ platform: 'android', ...urls }), { open: true, googlePlay: true, appStore: false, comingSoon: false });
    assert.deepEqual(planInstallCta({ platform: 'other', ...urls }), { open: false, googlePlay: true, appStore: true, comingSoon: false });
  });

  it('every store URL in the Web source goes through lib/appDownload.ts (no second hard-coded listing)', () => {
    const hardCoded = sources(root).filter(file => /apps\.apple\.com\/[a-z]{2}\/app\/|play\.google\.com\/store\/apps\/details/.test(readFileSync(file, 'utf8')));
    assert.deepEqual(hardCoded.map(file => file.slice(root.length + 1).replaceAll('\\', '/')), ['lib/appDownload.ts']);
  });
});
