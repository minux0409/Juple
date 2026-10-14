import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readLegalOperatorConfig } from '../lib/legalConfig.ts';
import { accountDeletionDocument, operatorFacts, pendingLegalReview, privacyDocument, termsDocument, type LegalDocument } from '../lib/legalContent.ts';
import { planLandingStore } from '../lib/publicLanding.ts';
import { isPublicOnly, PUBLIC_LANDING_PATH, PUBLIC_ONLY_NOT_FOUND_PATH, routePublicOnly } from '../lib/publicOnly.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const infra = (path: string) => readFileSync(new URL(`../../../infra/azure/${path}`, import.meta.url), 'utf8');

// A fictional operator: these tests are about the structure, never about the real values (those live only in the deployment).
const OPERATOR_ENV = {
  LEGAL_OPERATOR_NAME: '예시상호(Example)',
  LEGAL_REPRESENTATIVE_NAME: '홍길동',
  LEGAL_BUSINESS_REGISTRATION_NUMBER: '000-00-00000',
  LEGAL_BUSINESS_ADDRESS: '서울특별시 어딘가 1',
  LEGAL_EFFECTIVE_DATE: '2026-11-01',
  LEGAL_PRIVACY_OFFICER_NAME: '홍길동',
  LEGAL_PRIVACY_OFFICER_TITLE: '대표',
};

function text(doc: LegalDocument): string {
  return [doc.title, doc.description, doc.intro, ...doc.sections.flatMap(s => [s.title, ...s.blocks.flatMap(b => (b.kind === 'p' ? [b.text] : [...b.items]))])].join('\n');
}

describe('public-only launch mode', () => {
  it('is on only for an explicit "true"', () => {
    assert.equal(isPublicOnly({}), false);
    assert.equal(isPublicOnly({ JUPLE_WEB_PUBLIC_ONLY: '' }), false);
    assert.equal(isPublicOnly({ JUPLE_WEB_PUBLIC_ONLY: 'false' }), false);
    assert.equal(isPublicOnly({ JUPLE_WEB_PUBLIC_ONLY: 'yes' }), false);
    assert.equal(isPublicOnly({ JUPLE_WEB_PUBLIC_ONLY: 'true' }), true);
    assert.equal(isPublicOnly({ JUPLE_WEB_PUBLIC_ONLY: ' TRUE ' }), true);
  });

  it('serves "/" from the public landing page', () => {
    assert.deepEqual(routePublicOnly('/'), { kind: 'rewrite', path: PUBLIC_LANDING_PATH });
  });

  it('serves the legal pages, the share viewer, the app-link files and their assets', () => {
    for (const path of ['/welcome', '/privacy', '/terms', '/account-deletion', '/c/AbC123', '/c/AbC123/items', '/.well-known/assetlinks.json', '/.well-known/apple-app-site-association', '/robots.txt', '/brand/juple-app-icon-256.png', '/icon.png', '/apple-icon.png', '/favicon.ico']) {
      assert.deepEqual(routePublicOnly(path), { kind: 'serve' }, path);
    }
  });

  it('every signed-in path (and anything unknown) is a 404, never a sign-in or "not configured" screen', () => {
    for (const path of ['/archive', '/collections', '/collections/5', '/items/7', '/items/7/edit', '/me', '/me/trash', '/notifications', '/auth/callback', '/settings', '/c', '/privacy-old', '/welcome/x']) {
      assert.deepEqual(routePublicOnly(path), { kind: 'rewrite', path: PUBLIC_ONLY_NOT_FOUND_PATH }, path);
    }
  });

  it('the proxy changes nothing when the mode is off and never touches Next\'s own build assets', () => {
    const proxy = source('proxy.ts');
    assert.match(proxy, /if \(!isPublicOnly\(\)\) \{\s*return NextResponse\.next\(\);/);
    assert.match(proxy, /matcher: \['\/\(\(\?!_next\/\)\.\*\)'\]/);
  });

  it('Production deploys it on; Dev keeps the signed-in Web app', () => {
    assert.match(infra('web/prod.bicepparam'), /^param publicOnly = true$/m);
    assert.doesNotMatch(infra('web/dev.bicepparam'), /publicOnly/);
    const main = infra('web/main.bicep');
    assert.match(main, /param publicOnly bool = false/);
    assert.match(main, /publicOnly \? \[\s*\{\s*name: 'JUPLE_WEB_PUBLIC_ONLY'\s*value: 'true'\s*\}\s*\] : \[\]/);
  });
});

describe('public landing page', () => {
  it('Google Play for Android and desktop once the listing URL is configured', () => {
    const url = 'https://play.google.com/store/apps/details?id=com.juple.app';
    assert.deepEqual(planLandingStore({ platform: 'android', googlePlayUrl: url }), { googlePlayUrl: url, androidOnlyNote: false, comingSoon: false });
    assert.deepEqual(planLandingStore({ platform: 'other', googlePlayUrl: url }), { googlePlayUrl: url, androidOnlyNote: false, comingSoon: false });
  });

  it('an iPhone visitor gets a plain Android-first note, never a store button', () => {
    const url = 'https://play.google.com/store/apps/details?id=com.juple.app';
    assert.deepEqual(planLandingStore({ platform: 'ios', googlePlayUrl: url }), { googlePlayUrl: null, androidOnlyNote: true, comingSoon: false });
    assert.deepEqual(planLandingStore({ platform: 'ios', googlePlayUrl: undefined }), { googlePlayUrl: null, androidOnlyNote: true, comingSoon: false });
  });

  it('before the listing exists: a plain "coming soon" line, no dead-end link', () => {
    assert.deepEqual(planLandingStore({ platform: 'android', googlePlayUrl: undefined }), { googlePlayUrl: null, androidOnlyNote: false, comingSoon: true });
  });

  it('has no sign-in and no App Store, links the legal pages and shows the operator details', () => {
    const page = source('app/welcome/page.tsx');
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /signIn|AppRoot|msal|appStore|App Store|apps\.apple\.com/i);
    assert.match(page, /planLandingStore\(\{ platform: resolveClientPlatform\(requestHeaders\.get\('user-agent'\)\), googlePlayUrl: storeConfig\.googlePlayUrl \}\)/);
    for (const href of ['/privacy', '/terms', '/account-deletion']) {
      assert.match(page, new RegExp(`<Link href="${href}">`));
    }
    assert.match(page, /operatorFacts\(legal\)/);
  });
});

describe('legal pages: the operator, the privacy officer and the reviewed texts', () => {
  const config = readLegalOperatorConfig(OPERATOR_ENV);

  it('reads the representative, the e-commerce number and the privacy officer (whose mailbox defaults to the privacy mailbox)', () => {
    assert.equal(config.representativeName, '홍길동');
    assert.equal(config.ecommerceRegistrationNumber, undefined);
    assert.equal(config.privacyOfficerName, '홍길동');
    assert.equal(config.privacyOfficerTitle, '대표');
    assert.equal(config.privacyOfficerEmail, 'jupleinfo@gmail.com');
    assert.equal(readLegalOperatorConfig({ ...OPERATOR_ENV, LEGAL_PRIVACY_OFFICER_EMAIL: 'dpo@example.test' }).privacyOfficerEmail, 'dpo@example.test');
    assert.equal(readLegalOperatorConfig({ LEGAL_PRIVACY_OFFICER_TITLE: '대표' }).privacyOfficerTitle, undefined, 'a title without a name is ignored');
  });

  it('shows the operator facts in order, the e-commerce number only once configured', () => {
    assert.deepEqual(operatorFacts(config).map(f => f.label), ['서비스', '운영자', '대표자', '사업자등록번호', '사업장 주소']);
    const withEcommerce = readLegalOperatorConfig({ ...OPERATOR_ENV, LEGAL_ECOMMERCE_REGISTRATION_NUMBER: '2026-서울광진-0000' });
    assert.deepEqual(operatorFacts(withEcommerce).map(f => f.label), ['서비스', '운영자', '대표자', '사업자등록번호', '통신판매업 신고번호', '사업장 주소']);
  });

  it('the privacy policy names the privacy officer once configured, and leaves the section out otherwise', () => {
    const configured = privacyDocument(config);
    const officer = configured.sections.find(section => section.id === 'privacy-officer');
    assert.ok(officer);
    assert.match(text(configured), /성명: 홍길동 \(대표\)/);
    assert.match(text(configured), /연락처: jupleinfo@gmail\.com/);
    assert.equal(privacyDocument(readLegalOperatorConfig({})).sections.some(section => section.id === 'privacy-officer'), false);
  });

  it('numbers the privacy policy without gaps whichever optional sections are present', () => {
    for (const doc of [privacyDocument(config), privacyDocument(readLegalOperatorConfig({}))]) {
      doc.sections.forEach((section, index) => assert.ok(section.title.startsWith(`${index + 1}. `), section.title));
    }
  });

  it('names the processors with what each handles; the overseas-transfer and under-14 texts wait for the legal review', () => {
    const privacy = text(privacyDocument(config));
    assert.match(privacy, /Microsoft\(Microsoft Entra External ID\): 회원 가입·로그인과 본인 확인/);
    assert.match(privacy, /Google\(Firebase Cloud Messaging\): 푸시 알림 전송/);
    assert.match(privacy, /Google\(Google Play\): 구독 결제, 갱신, 해지, 환불/);
    assert.deepEqual(pendingLegalReview(), ['overseasTransfers', 'minorsPolicy']);
    assert.equal(privacyDocument(config).sections.some(section => section.id === 'overseas-transfer' || section.id === 'minors'), false);
  });

  it('the terms state the paid model: 30 free days, then a monthly Google Play subscription that deleting the account does not cancel', () => {
    const terms = text(termsDocument(config));
    assert.match(terms, /가입 후 30일은 Juple이 제공하는 무료 이용 기간입니다/);
    assert.match(terms, /월 단위 자동 갱신 구독/);
    assert.match(terms, /결제·갱신·해지·환불은 Google Play의 약관과 정책을 따릅니다/);
    assert.match(terms, /계정을 삭제해도 스토어 구독은 자동으로 해지되지 않으므로/);
    assert.doesNotMatch(terms, /구독 기능이 제공되는 경우/);
  });

  it('never shows a placeholder, with or without the operator configured', () => {
    for (const operator of [config, readLegalOperatorConfig({})]) {
      for (const doc of [privacyDocument(operator), termsDocument(operator), accountDeletionDocument(operator)]) {
        assert.doesNotMatch(text(doc), /TODO|TBD|placeholder|미정|확인 필요|추후|\[[^\]]*\]|undefined|null/i, doc.slug);
      }
    }
  });

  it('a launch deployment cannot go out without the representative and the privacy officer', () => {
    const guard = infra('web/launch-settings-guard.bicep');
    for (const name of ['legalOperatorName', 'legalRepresentativeName', 'legalBusinessRegistrationNumber', 'legalBusinessAddress', 'legalEffectiveDate', 'legalPrivacyOfficerName', 'googlePlayUrl']) {
      assert.match(guard, new RegExp(`@minLength\\(1\\)\\s*#disable-next-line no-unused-params\\s*param ${name} string`), name);
    }
    const main = infra('web/main.bicep');
    for (const name of ['legalRepresentativeName', 'legalPrivacyOfficerName']) {
      assert.match(main, new RegExp(`    ${name}: ${name}`), `${name} is passed to the guard`);
    }
    for (const env of ['LEGAL_REPRESENTATIVE_NAME', 'LEGAL_ECOMMERCE_REGISTRATION_NUMBER', 'LEGAL_PRIVACY_OFFICER_NAME', 'LEGAL_PRIVACY_OFFICER_TITLE', 'LEGAL_PRIVACY_OFFICER_EMAIL']) {
      assert.match(main, new RegExp(`  ${env}: legal`), env);
    }
  });
});
