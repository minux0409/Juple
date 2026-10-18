import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  androidOpenAppUrl,
  ANDROID_PACKAGE_ID,
  APP_OPEN_FAILED_PARAM,
  isInAppBrowser,
  OPEN_APP_PATH,
  CONTINUE_ON_WEB_KEY,
  DEFAULT_GOOGLE_PLAY_URL,
  planMobileLanding,
  resolveAppDownload,
  resolveMobileOs,
} from '../lib/appDownload.ts';
import { androidOpenInAppUrl } from '../lib/shareLinks.ts';
import { storeConfig } from '../lib/storeConfig.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S936N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

describe('app download config (one source)', () => {
  it('Google Play is the real listing of com.juple.app unless the environment overrides it; the App Store is never invented', () => {
    assert.equal(ANDROID_PACKAGE_ID, 'com.juple.app');
    assert.equal(DEFAULT_GOOGLE_PLAY_URL, 'https://play.google.com/store/apps/details?id=com.juple.app');
    assert.deepEqual(resolveAppDownload({}), { googlePlayUrl: DEFAULT_GOOGLE_PLAY_URL, appStoreUrl: null });
    assert.deepEqual(resolveAppDownload({ googlePlayUrl: '', appStoreUrl: '' }), { googlePlayUrl: DEFAULT_GOOGLE_PLAY_URL, appStoreUrl: null });
    assert.equal(resolveAppDownload({ appStoreUrl: 'https://apps.apple.com/app/id1' }).appStoreUrl, 'https://apps.apple.com/app/id1');
    // only https links are ever offered
    assert.equal(resolveAppDownload({ appStoreUrl: 'javascript:alert(1)' }).appStoreUrl, null);
    assert.equal(resolveAppDownload({ googlePlayUrl: 'http://x.test' }).googlePlayUrl, DEFAULT_GOOGLE_PLAY_URL);
    // the public share page reads the same source
    assert.equal(storeConfig.googlePlayUrl, process.env.GOOGLE_PLAY_URL ? resolveAppDownload({ googlePlayUrl: process.env.GOOGLE_PLAY_URL }).googlePlayUrl : DEFAULT_GOOGLE_PLAY_URL);
  });

  it('the store URLs live in lib/appDownload.ts only - no page hard-codes them', () => {
    for (const file of ['app/(app)/SidebarAppCard.tsx', 'app/(app)/MobileAppLanding.tsx', 'app/(app)/AppShell.tsx', 'app/(app)/layout.tsx']) {
      assert.doesNotMatch(source(file), /play\.google\.com|apps\.apple\.com/, file);
    }
  });
});

describe('mobile detection and the landing plan', () => {
  it('phones are mobile; tablets, iPads and desktops keep the ordinary Web', () => {
    assert.equal(resolveMobileOs(ANDROID_PHONE), 'android');
    assert.equal(resolveMobileOs(IPHONE), 'ios');
    for (const ua of [ANDROID_TABLET, IPAD, DESKTOP, '', null, undefined]) {
      assert.equal(resolveMobileOs(ua), null, String(ua));
    }
  });

  it('Android: open + Google Play; iPhone: App Store only when configured, otherwise a disabled "coming soon" - never Google Play', () => {
    const noStore = resolveAppDownload({});
    assert.deepEqual(planMobileLanding('android', noStore), { open: true, googlePlay: true, appStore: false, appStoreSoon: false });
    assert.deepEqual(planMobileLanding('ios', noStore), { open: false, googlePlay: false, appStore: false, appStoreSoon: true });
    assert.deepEqual(planMobileLanding('ios', resolveAppDownload({ appStoreUrl: 'https://apps.apple.com/app/id1' })), { open: false, googlePlay: false, appStore: true, appStoreSoon: false });
  });

  it('"open the app": a VIEW intent for the dedicated /open-app App Link - package, https, BROWSABLE, a visible fallback; no launcher intent', () => {
    const url = androidOpenAppUrl('juple.co.kr');
    assert.equal(OPEN_APP_PATH, '/open-app');
    assert.match(url, /^intent:\/\/juple\.co\.kr\/open-app#Intent;scheme=https;action=android\.intent\.action\.VIEW;category=android\.intent\.category\.BROWSABLE;package=com\.juple\.app;/);
    assert.ok(url.endsWith(`S.browser_fallback_url=${encodeURIComponent('https://juple.co.kr/?appOpenFailed=1')};end`));
    assert.equal(APP_OPEN_FAILED_PARAM, 'appOpenFailed');
    // The old launcher intent (it never resolved: Chrome adds BROWSABLE, the launcher filter has none) is gone.
    assert.doesNotMatch(url, /MAIN|LAUNCHER/);
    // No timer / store redirect / custom scheme / foreign host: the fallback is this site over https, nothing of the current page is passed.
    assert.doesNotMatch(url, /play\.google\.com|market:|juple:\/\/|[?&]utm|#.*#/);
    assert.equal(decodeURIComponent(url.split('S.browser_fallback_url=')[1].replace(';end', '')), 'https://juple.co.kr/?appOpenFailed=1');
    // Share links keep their own intent (the exact Collection).
    assert.match(androidOpenInAppUrl('juple.co.kr', 'abc'), /^intent:\/\/juple\.co\.kr\/c\/abc#Intent;scheme=https;package=com\.juple\.app;/);
  });

  it('the host is the app\'s own (dev and production differ): the intent and its fallback always use it', () => {
    assert.match(androidOpenAppUrl('dev.juple.co.kr'), /^intent:\/\/dev\.juple\.co\.kr\/open-app#Intent;/);
    assert.ok(androidOpenAppUrl('dev.juple.co.kr').includes(encodeURIComponent('https://dev.juple.co.kr/?appOpenFailed=1')));
  });

  it('the landing button is a real link (the intent starts from the person\'s tap) - no script navigation, no timer', () => {
    const landing = source('app/(app)/MobileAppLanding.tsx');
    assert.match(landing, /<a className=\{styles\.primaryAction\} data-app-open href=\{host \? androidOpenAppUrl\(host\) : undefined\}>/);
    assert.doesNotMatch(landing, /window\.location\.href|location\.replace|window\.open|setTimeout|androidLaunchAppUrl/);
    assert.doesNotMatch(landing, /MAIN|LAUNCHER/);
  });

  it('a failed open is said out loud (the fallback brings back appOpenFailed=1), with the store and 웹에서 계속하기 still there', () => {
    const landing = source('app/(app)/MobileAppLanding.tsx');
    assert.match(landing, /useSearchParams\(\)\.get\(APP_OPEN_FAILED_PARAM\) !== null/);
    assert.match(landing, /data-app-open-failed role="status">\s*\{dictionary\.appOpenFailed\}/);
    assert.match(landing, /data-store="google-play"/);
    assert.match(landing, /data-continue-web/);
    for (const language of ['ko', 'en'] as const) {
      const words = getAppDictionary(language);
      assert.ok(words.appOpenFailed.length > 10 && words.appOpenInAppBrowserHint.length > 10, language);
    }
    assert.equal(getAppDictionary('ko').appOpenFailed, 'Juple 앱을 열 수 없었어요. 앱이 설치되어 있지 않다면 Google Play에서 받아 주세요.');
  });

  it('an in-app browser gets one quiet hint next to the button; ordinary browsers never do', () => {
    const kakao = 'Mozilla/5.0 (Linux; Android 14; SM-S936N Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36; KAKAOTALK 2511290';
    const webview = 'Mozilla/5.0 (Linux; Android 14; SM-S936N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36';
    assert.equal(isInAppBrowser(kakao), true);
    assert.equal(isInAppBrowser(webview), true);
    assert.equal(isInAppBrowser('Mozilla/5.0 (Linux; Android 14; SM-S936N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.0)'), true);
    for (const ua of [ANDROID_PHONE, IPHONE, DESKTOP, '', null, undefined, 'Mozilla/5.0 (Linux; Android 14; SM-S936N) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36']) {
      assert.equal(isInAppBrowser(ua), false, String(ua));
    }
    const landing = source('app/(app)/MobileAppLanding.tsx');
    assert.match(landing, /\{plan\.open && inAppBrowser \? \(\s*<p className=\{styles\.mobileLandingHint\} data-in-app-browser-hint>/);
    assert.doesNotMatch(landing, /kakao|kakaotalk:\/\//i, 'no vendor-specific scheme');
    assert.match(source('app/(app)/layout.tsx'), /inAppBrowser=\{isInAppBrowser\(requestHeaders\.get\('user-agent'\)\)\}/);
  });

  it('only Android gets the app button; iPhone, desktop and the other buttons are untouched', () => {
    const noStore = resolveAppDownload({});
    assert.equal(planMobileLanding('android', noStore).open, true);
    assert.equal(planMobileLanding('ios', noStore).open, false);
    assert.equal(resolveMobileOs(DESKTOP), null);
    const landing = source('app/(app)/MobileAppLanding.tsx');
    assert.match(landing, /plan\.googlePlay \? \(/);
    assert.match(landing, /plan\.appStore && download\.appStoreUrl/);
    assert.match(landing, /onClick=\{onContinueOnWeb\}/);
  });
});

describe('where the mobile landing applies', () => {
  it('only the signed-in app group is behind it: legal pages and public share links are separate routes that never import it', () => {
    const appRoot = source('app/(app)/AppRoot.tsx');
    assert.match(appRoot, /if \(mobileOs && !continueOnWeb\) \{\s*return <MobileAppLanding/);
    for (const file of ['app/privacy', 'app/terms', 'app/account-deletion', 'app/c/[publicId]']) {
      assert.ok(existsSync(new URL(`../${file}/`, import.meta.url)), file);
    }
    for (const file of ['app/privacy/page.tsx', 'app/terms/page.tsx', 'app/account-deletion/page.tsx', 'app/c/[publicId]/page.tsx', 'app/_legal/LegalDocumentView.tsx']) {
      assert.doesNotMatch(source(file), /MobileAppLanding|resolveMobileOs|mobileOs/, file);
    }
    assert.doesNotMatch(source('proxy.ts'), /play\.google|redirect\(|MobileOs/, 'no blanket redirect to a store');
  });

  it('"웹에서 계속하기" keeps the Web for this tab session only; nothing about the visitor is stored', () => {
    const landing = source('app/(app)/MobileAppLanding.tsx');
    assert.equal(CONTINUE_ON_WEB_KEY, 'juple.continueOnWeb');
    assert.match(landing, /sessionStorage\.setItem\(CONTINUE_ON_WEB_KEY, '1'\)/);
    assert.doesNotMatch(landing, /localStorage|document\.cookie|navigator\.userAgent|fetch\(/);
  });

  it('the share page keeps its own preview and install block (and now offers the real Google Play link)', () => {
    const page = source('app/c/[publicId]/page.tsx');
    assert.match(page, /InstallCta/);
    assert.match(page, /AutoOpenInApp/);
  });
});

describe('desktop side bar app card', () => {
  const shell = source('app/(app)/AppShell.tsx');
  const card = source('app/(app)/SidebarAppCard.tsx');
  const css = source('app/(app)/app.module.css');

  it('sits at the end of the side bar, after the navigation, with a real Google Play link and a disabled App Store until a listing exists', () => {
    assert.match(shell, /<\/nav>\s*<SidebarAppCard dictionary=\{dictionary\} download=\{appDownload\} \/>\s*<\/header>/);
    assert.match(card, /href=\{download\.googlePlayUrl\}/);
    assert.match(card, /download\.appStoreUrl \? \(/);
    assert.match(card, /data-store="app-store-soon" disabled/);
    assert.match(css, /\.sidebarApp \{\s*margin-top: auto;/);
  });

  it('each store shows its own mark (play triangle / apple) AND its word; the marks are decorative, with no new dependency', () => {
    const compact = card.replace(/\s+/g, ' ');
    assert.ok(compact.includes('<PlayMark /> {dictionary.appGooglePlay}'));
    assert.ok(compact.includes('<AppleMark /> {dictionary.appAppStore} </a>'));
    assert.ok(compact.includes('<AppleMark /> {dictionary.appAppStore} · {dictionary.appStoreSoonShort}'));
    assert.equal(card.match(/aria-hidden className=\{styles\.sidebarAppIcon\}/g)?.length, 2);
    assert.doesNotMatch(card, /<img|^import .* from '[^.]/m);
  });

  it('every store control has a text name (never an icon alone) and opens in a new tab safely', () => {
    assert.match(card, /\{dictionary\.appGooglePlay\}/);
    assert.match(card, /\{dictionary\.appAppStore\}/);
    assert.match(card, /rel="noopener noreferrer" target="_blank"/);
  });

  it('is hidden where the side bar turns into a top bar, and uses theme tokens only', () => {
    assert.match(css, /@media \(max-width: 860px\), \(max-height: 600px\) \{\s*\.sidebarApp \{\s*display: none;/);
    const block = css.slice(css.indexOf('/* ---- Get the app'));
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'no literal colours: Light and Dark follow the tokens');
    assert.match(block, /\.sidebarApp \{[^}]*background: var\(--app-surface-muted\)/);
    assert.match(block, /\.mobileLanding \{[^}]*background: var\(--app-background\)/);
    // Rendered outside .shell: it must join both token scopes (light and dark) and the brand tokens, or the primary button loses its colour.
    assert.match(css, /\.toastHost,\s*\.tourRoot,\s*\.mobileLanding,\s*\.collectionDialog \{\s*--app-background/);
    assert.match(css, /:global\(html\[data-theme='dark'\]\) \.mobileLanding,\s*:global\(html\[data-theme='dark'\]\) \.collectionDialog \{/);
    assert.match(css, /\.toastHost,\s*\.tourRoot,\s*\.mobileLanding \{\s*--juple-orange/);
  });
});

describe('texts', () => {
  it('Korean and English name every action', () => {
    for (const language of ['ko', 'en'] as const) {
      const words = getAppDictionary(language);
      for (const key of ['mobileLandingTitle', 'mobileLandingBody', 'appOpen', 'appGetOnGooglePlay', 'appGetOnAppStore', 'appStoreSoon', 'appStoreSoonShort', 'appContinueOnWeb', 'sidebarAppTitle', 'sidebarAppBody', 'appGooglePlay', 'appAppStore'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
      }
    }
    assert.equal(getAppDictionary('ko').appOpen, 'Juple 앱 열기');
  });
});

describe('verification files (static audit)', () => {
  it('assetlinks serves com.juple.app with the fingerprints from configuration only (the Play App Signing certificate in Production), 404 when unset', () => {
    const route = source('app/.well-known/assetlinks.json/route.ts');
    assert.ok(route.includes("package_name: 'com.juple.app'"));
    assert.ok(route.includes('process.env.ANDROID_ASSETLINKS_SHA256_FINGERPRINTS'));
    assert.match(route, /status: 404/);
    assert.doesNotMatch(route, /[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}/, 'no fingerprint is hard-coded');
  });

  it('the AASA stays 404 without IOS_APP_ID (no Apple Team ID exists yet) and only claims /c/*', () => {
    const route = source('app/.well-known/apple-app-site-association/route.ts');
    assert.ok(route.includes('process.env.IOS_APP_ID'));
    assert.match(route, /status: 404/);
    assert.ok(route.includes("components: [{ '/': '/c/*' }]"));
  });
});
