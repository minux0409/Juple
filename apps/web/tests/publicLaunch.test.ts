import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { readLegalOperatorConfig } from '../lib/legalConfig.ts';
import { accountDeletionDocument, operatorFacts, pendingLegalReview, privacyDocument, termsDocument, type LegalDocument } from '../lib/legalContent.ts';
import { getDictionary } from '../lib/i18n.ts';
import { planLandingStore } from '../lib/publicLanding.ts';
import { buildShareMetadata } from '../lib/shareView.ts';
import { buildSiteMetadata, SITE_SHARE_IMAGE } from '../lib/siteMetadata.ts';
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
    assert.deepEqual(planLandingStore({ platform: 'android', googlePlayUrl: url }), { googlePlayUrl: url, androidOnlyNote: false });
    assert.deepEqual(planLandingStore({ platform: 'other', googlePlayUrl: url }), { googlePlayUrl: url, androidOnlyNote: false });
  });

  it('an iPhone visitor gets a plain Android-first note, never a store button', () => {
    const url = 'https://play.google.com/store/apps/details?id=com.juple.app';
    assert.deepEqual(planLandingStore({ platform: 'ios', googlePlayUrl: url }), { googlePlayUrl: null, androidOnlyNote: true });
    assert.deepEqual(planLandingStore({ platform: 'ios', googlePlayUrl: undefined }), { googlePlayUrl: null, androidOnlyNote: true });
  });

  it('before the public listing exists: no store link and no "coming soon" placeholder at all', () => {
    assert.deepEqual(planLandingStore({ platform: 'android', googlePlayUrl: undefined }), { googlePlayUrl: null, androidOnlyNote: false });
    assert.deepEqual(planLandingStore({ platform: 'other', googlePlayUrl: '' }), { googlePlayUrl: null, androidOnlyNote: false });
    assert.doesNotMatch(source('app/welcome/page.tsx'), /installComingSoon|comingSoon|play\.google\.com|testing/i);
  });

  it('is a real landing: the lockup, the product line and the three features the app actually has', () => {
    const page = source('app/welcome/page.tsx');
    assert.match(page, /<BrandIcon size=\{56\} \/>\s*<h1 className=\{landing\.wordmark\}>Juple<\/h1>/);
    assert.match(page, /dict\.landingHeadlineLine1[\s\S]*dict\.landingHeadlineLine2/);
    for (const key of ['featureSaveTitle', 'featureOrganizeTitle', 'featureShareTitle']) {
      assert.match(page, new RegExp(`dict\\.${key}`), key);
    }
    const ko = getDictionary('ko');
    assert.equal(`${ko.landingHeadlineLine1} ${ko.landingHeadlineLine2}`, '발견한 것들을 모아두고, 나중에 다시 꺼내보세요.');
    assert.deepEqual([ko.featureSaveTitle, ko.featureOrganizeTitle, ko.featureShareTitle], ['링크 저장', '컬렉션 정리', '공유·협업']);
    for (const locale of ['ko', 'en'] as const) {
      assert.doesNotMatch(Object.values(getDictionary(locale)).join('\n'), /DEV|Production|임시|테스트|Closed Testing/, locale);
    }
  });

  it('describes itself for link previews: canonical juple.co.kr, Open Graph and Twitter with the Juple app icon', () => {
    const meta = buildSiteMetadata('A description.', '/');
    assert.equal(meta.title, 'Juple');
    assert.equal(meta.description, 'A description.');
    assert.equal(meta.alternates?.canonical, 'https://juple.co.kr/');
    assert.deepEqual(meta.openGraph, { title: 'Juple', description: 'A description.', url: 'https://juple.co.kr/', siteName: 'Juple', type: 'website', images: [SITE_SHARE_IMAGE] });
    assert.deepEqual(meta.twitter, { card: 'summary', title: 'Juple', description: 'A description.', images: ['/brand/juple-share-512.png'] });
    assert.deepEqual(routePublicOnly(SITE_SHARE_IMAGE.url), { kind: 'serve' }, 'the preview image is served in public-only mode');
    assert.ok(readFileSync(new URL('../public/brand/juple-share-512.png', import.meta.url)).length > 0);
    assert.match(source('app/welcome/page.tsx'), /buildSiteMetadata\(dict\.landingDescription, '\/'\)/);
    const layout = source('app/layout.tsx');
    assert.match(layout, /metadataBase: new URL\(SITE_URL\)/);
    assert.match(layout, /images: \[SITE_SHARE_IMAGE\]/);
    assert.match(layout, /index: false/, 'the site stays noindex');
  });

  it('a shared Collection keeps its own image-less preview (its openGraph / twitter replace the site defaults)', () => {
    for (const kind of ['notFound', 'locked', 'unavailable'] as const) {
      const meta = buildShareMetadata({ kind }, null, 'desc');
      assert.equal('images' in meta.openGraph, false);
      assert.equal('images' in meta.twitter, false);
    }
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

describe('the 404 and "cannot show it" pages', () => {
  it('carry the Juple lockup, a short explanation and a way home - and no app install or open link', () => {
    const code = source('app/_components/PublicStatePage.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(code, /<BrandIcon size=\{48\} \/>/);
    assert.match(code, /<Link className="stateHomeLink" href="\/">/);
    assert.doesNotMatch(code, /InstallCta|googlePlay|appStore|intent:|openInApp|play\.google/i);
    assert.match(source('app/not-found.tsx'), /<PublicStatePage homeLabel=\{dict\.notFoundHome\}/);
    assert.match(source('app/c/[publicId]/page.tsx'), /if \(view\.kind === 'unavailable'\) \{\s*return <PublicStatePage homeLabel=\{dict\.notFoundHome\}/);
    assert.equal(getDictionary('ko').notFoundHome, 'Juple 홈으로 가기');
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

  it('states the email-only sign-in: no Google or Apple sign-in anywhere, while Google Play and Firebase stay disclosed', () => {
    for (const operator of [config, readLegalOperatorConfig({})]) {
      const privacy = text(privacyDocument(operator));
      const terms = text(termsDocument(operator));
      const deletion = text(accountDeletionDocument(operator));
      for (const [slug, body] of [['privacy', privacy], ['terms', terms], ['account-deletion', deletion]] as const) {
        assert.doesNotMatch(body, /Google 로그인|Apple 로그인|Google 계정|Apple 계정|Google, Apple|Google 또는 Apple|선택한 로그인 방식/, slug);
        assert.doesNotMatch(body.replace(/Google\((Firebase Cloud Messaging|Google Play)\)|Google Firebase Cloud Messaging|Google Play|Firebase Cloud Messaging/g, ''), /Google|Apple/, `${slug}: Google/Apple only as Play and Firebase`);
      }
      assert.match(privacy, /회원 가입과 로그인은 이메일 주소와 비밀번호로 하며, Microsoft Entra External ID를 통해 이루어집니다/);
      assert.match(privacy, /Microsoft\(Microsoft Entra External ID\): 회원 가입·로그인과 본인 확인\. 로그인에 쓰는 이메일 주소와 비밀번호, 로그인 식별자를 처리합니다/);
      assert.match(privacy, /Google\(Firebase Cloud Messaging\): 푸시 알림 전송/);
      assert.match(privacy, /Google\(Google Play\): 구독 결제, 갱신, 해지, 환불/);
      assert.match(terms, /계정은 이메일 주소와 비밀번호로 만들며/);
      assert.match(terms, /결제·갱신·해지·환불은 Google Play의 약관과 정책을 따릅니다/);
      assert.match(deletion, /가입과 로그인에 사용한 이메일 주소/);
      assert.match(deletion, /본인 확인을 위해 \*\*다시 로그인\*\*합니다/);
      assert.match(deletion, /계정을 삭제해도 Google Play 구독은 자동으로 해지되지 않습니다/);
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
