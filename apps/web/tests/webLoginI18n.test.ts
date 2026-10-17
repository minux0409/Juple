import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES, parseLanguagePreference, resolveAppLanguage, resolveSystemLanguage } from '../lib/appI18n.ts';
import { localizedBusinessFacts } from '../lib/businessFacts.ts';
import { getDictionary, resolveLocale, resolvePublicLocale } from '../lib/i18n.ts';
import type { LegalOperatorConfig } from '../lib/legalConfig.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const SIGN_IN_KEYS = [
  'signIn', 'signingIn', 'checkingLogin', 'signInFailed', 'signInCancelled', 'signInHeadlineLine1', 'signInHeadlineLine2', 'signInSupportingText',
  'signInTitle', 'signInDescription', 'signInMicrosoftNote', 'signInFeatureSave', 'signInFeatureOrganize', 'signInFeatureShare', 'businessInfo',
  'businessInfoTitle', 'privacyLink', 'termsLink', 'accountDeletionLink', 'signInConfigError', 'sessionEnded', 'configMissingTitle',
  'configMissingMessage', 'close', 'businessOperator', 'businessRepresentative', 'businessRegistrationNumber', 'businessEcommerceNumber',
  'businessAddress', 'businessSupportEmail',
] as const;

describe('Web sign-in page: the visitor\'s language', () => {
  it('ko-KR browser: Korean; en-US browser: English; the source is the browser (no account exists before sign-in)', () => {
    assert.equal(resolveAppLanguage('system', 'ko-KR,ko;q=0.9,en-US;q=0.8'), 'ko');
    assert.equal(resolveAppLanguage('system', 'en-US,en;q=0.9'), 'en');
    const ko = getAppDictionary('ko');
    const en = getAppDictionary('en');
    assert.equal(ko.signInTitle, 'Juple 시작하기');
    assert.equal(ko.signIn.length > 0, true);
    assert.equal(ko.privacyLink, '개인정보처리방침');
    assert.equal(ko.termsLink, '이용약관');
    assert.equal(ko.signInHeadlineLine1, '발견한 것들을 모아두고,');
    assert.equal(en.signInTitle, 'Get started with Juple');
    assert.equal(en.privacyLink, 'Privacy Policy');
    assert.equal(en.termsLink, 'Terms of Service');
    // a saved 언어 choice (cookie) wins over the browser once there is one
    assert.equal(resolveAppLanguage('ja', 'en-US'), 'ja');
  });

  it('an unsupported browser language falls back to English (the mobile fallback)', () => {
    assert.equal(resolveSystemLanguage('sw-KE,sw;q=0.9'), 'en');
    assert.equal(resolveSystemLanguage(''), 'en');
    assert.equal(resolveSystemLanguage(null), 'en');
    assert.equal(resolveAppLanguage('system', 'sw-KE'), 'en');
    assert.equal(getAppDictionary(resolveAppLanguage('system', 'sw-KE')).signInTitle, 'Get started with Juple');
  });

  it('every one of the 17 languages has every sign-in page string - and no language shows another language\'s first screen', () => {
    const en = getAppDictionary('en');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of SIGN_IN_KEYS) {
        assert.ok(String(words[key]).trim().length > 0, `${language}.${key}`);
      }
      if (language !== 'en') {
        // The first-screen sentences are translated, not English copies (a few short labels may coincide, e.g. a brand-like word).
        for (const key of ['signInTitle', 'signInDescription', 'signInMicrosoftNote', 'signInSupportingText', 'signInConfigError'] as const) {
          assert.notEqual(words[key], en[key], `${language}.${key} must not be the English text`);
        }
      }
    }
    assert.match(getAppDictionary('ja').signInTitle, /Juple/);
    assert.match(getAppDictionary('ja').signInDescription, /ログイン/);
    assert.match(getAppDictionary('de').signInDescription, /Konto/);
  });

  it('the business-information dialog: labels in the visitor\'s language, the registered values as they are', () => {
    const config = {
      serviceName: 'Juple', operatorName: '주식회사 예시', representativeName: '홍길동', businessRegistrationNumber: '123-45-67890',
      ecommerceRegistrationNumber: '2026-서울광진-0000', ecommerceRegistrationAuthority: '광진구청', businessAddress: '서울시 광진구', supportEmail: 'help@example.test',
    } as unknown as LegalOperatorConfig;
    const ko = localizedBusinessFacts(config, getAppDictionary('ko'));
    assert.deepEqual(ko.map(fact => fact.label), ['운영자', '대표자', '사업자등록번호', '통신판매업 신고번호', '사업장 주소', '문의 이메일']);
    const en = localizedBusinessFacts(config, getAppDictionary('en'));
    assert.deepEqual(en.map(fact => fact.label), ['Operator', 'Representative', 'Business registration number', 'Mail-order business report number', 'Business address', 'Contact email']);
    assert.deepEqual(en.map(fact => fact.value), ko.map(fact => fact.value));
    assert.equal(localizedBusinessFacts(config, getAppDictionary('ja'))[0].label, '運営者');
    // nothing configured: no rows at all (never an invented one)
    assert.deepEqual(localizedBusinessFacts({ serviceName: 'Juple' } as unknown as LegalOperatorConfig, getAppDictionary('en')), []);
  });

  it('the sign-in page, the layout and the callback bridge hold no hard-coded user-facing text', () => {
    for (const path of ['app/(app)/Landing.tsx', 'app/(app)/layout.tsx', 'app/auth/callback/RedirectBridge.tsx']) {
      assert.doesNotMatch(source(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''), /[가-힣]/, path);
    }
    assert.doesNotMatch(source('app/(app)/Landing.tsx'), /lang="ko">\s*\{businessFacts/);
  });
});

describe('Web public pages (shared viewer, store landing): Korean / English', () => {
  it('ko-KR and en-US pick their own language; the order of preference decides, not the first listed tag', () => {
    assert.equal(resolveLocale('ko-KR,ko;q=0.9,en-US;q=0.8'), 'ko');
    assert.equal(resolveLocale('en-US,en;q=0.9'), 'en');
    assert.equal(resolveLocale('en;q=0.5, ko'), 'ko');
    assert.equal(resolveLocale('fr, ko;q=0.5'), 'ko');
  });

  it('unsupported, empty or malformed headers fall back to English', () => {
    assert.equal(resolveLocale('ja-JP,ja;q=0.9'), 'en');
    assert.equal(resolveLocale('*'), 'en');
    assert.equal(resolveLocale(''), 'en');
    assert.equal(resolveLocale(null), 'en');
    assert.equal(resolveLocale('ko;q=0'), 'en');
    assert.equal(resolveLocale('korean-nonsense'), 'en');
  });

  it('the footer / legal / state texts exist in both languages', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dictionary = getDictionary(locale);
      for (const key of ['landingPrivacy', 'landingTerms', 'landingAccountDeletion', 'unlock', 'unlocking', 'wrongPassword', 'loading', 'unavailableTitle', 'notFoundTitle', 'footerNote'] as const) {
        assert.ok(dictionary[key].length > 0, `${locale}.${key}`);
      }
    }
    assert.equal(getDictionary('ko').landingPrivacy, '개인정보처리방침');
    assert.equal(getDictionary('en').landingTerms, 'Terms of Service');
  });
});

describe('Which language: the saved 언어 cookie first, then the browser, then English', () => {
  /** The sign-in page and the app: the layout's own composition of cookie + Accept-Language. */
  const login = (cookie: string | undefined, accept: string | null) => resolveAppLanguage(parseLanguagePreference(cookie), accept);

  it('sign-in page', () => {
    assert.equal(login('ko', 'en-US,en;q=0.9'), 'ko');
    assert.equal(login('en', 'ko-KR,ko;q=0.9'), 'en');
    assert.equal(login('not-a-language', 'ja-JP,ja;q=0.9'), 'ja');
    assert.equal(login('', 'sw-KE'), 'en');
    assert.equal(login(undefined, null), 'en');
    assert.equal(login('xx', 'sw-KE'), 'en');
  });

  it('public pages (Korean / English text): the cookie decides when it is ko or en; a saved language without public text is English', () => {
    assert.equal(resolvePublicLocale('ko', 'en-US'), 'ko');
    assert.equal(resolvePublicLocale('en', 'ko-KR'), 'en');
    assert.equal(resolvePublicLocale('garbage', 'ko-KR'), 'ko');
    assert.equal(resolvePublicLocale('garbage', 'ja-JP'), 'en', 'no public Japanese text: the fallback');
    assert.equal(resolvePublicLocale(undefined, 'ko-KR'), 'ko');
    assert.equal(resolvePublicLocale('ja', 'ko-KR'), 'en');
    assert.equal(resolvePublicLocale('system', 'ko-KR'), 'ko');
    assert.equal(resolvePublicLocale(undefined, null), 'en');
  });

  it('every public page reads the cookie (and the legal documents stay Korean)', () => {
    for (const path of ['app/(app)/page.tsx', 'app/c/[publicId]/page.tsx', 'app/not-found.tsx', 'app/welcome/page.tsx']) {
      const text = source(path);
      assert.match(text, /resolvePublicLocale\(\(await cookies\(\)\)\.get\(LANGUAGE_COOKIE\)\?\.value/, path);
      assert.doesNotMatch(text, /resolveLocale\(/, path);
    }
    assert.doesNotMatch(source('app/privacy/page.tsx'), /LANGUAGE_COOKIE|resolvePublicLocale/);
  });
});
