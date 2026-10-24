import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIRMED_CONTACT_EMAIL, formatLegalDate, readLegalOperatorConfig } from '../lib/legalConfig.ts';
import { accountDeletionDocument, operatorFacts, privacyDocument, termsDocument, type LegalDocument } from '../lib/legalContent.ts';
import { buildLegalMetadata } from '../lib/legalMetadata.ts';
import { legalSecurityHeaders, securityHeaders } from '../lib/securityHeaders.ts';

const noOperator = readLegalOperatorConfig({});

function text(doc: LegalDocument): string {
  return [doc.title, doc.description, doc.intro, ...doc.sections.flatMap(s => [s.title, ...s.blocks.flatMap(b => (b.kind === 'p' ? [b.text] : [...b.items]))])].join('\n');
}

const docs = (config = noOperator) => [privacyDocument(config), termsDocument(config), accountDeletionDocument(config)];

describe('operator config', () => {
  it('with no environment only the confirmed contact mailbox is present; every operator/business field is absent', () => {
    assert.equal(CONFIRMED_CONTACT_EMAIL, 'jupleinfo@gmail.com');
    assert.deepEqual(noOperator, {
      serviceName: 'Juple',
      operatorName: undefined,
      representativeName: undefined,
      businessRegistrationNumber: undefined,
      ecommerceRegistrationNumber: undefined,
      ecommerceRegistrationAuthority: undefined,
      businessAddress: undefined,
      supportEmail: 'jupleinfo@gmail.com',
      privacyEmail: 'jupleinfo@gmail.com',
      privacyOfficerName: undefined,
      privacyOfficerTitle: undefined,
      privacyOfficerEmail: undefined,
      effectiveDate: undefined,
    });
    assert.deepEqual(operatorFacts(noOperator), [{ label: '서비스', value: 'Juple' }]);
  });

  it('ignores blank values, malformed mailboxes and malformed dates', () => {
    const config = readLegalOperatorConfig({ LEGAL_OPERATOR_NAME: '  ', LEGAL_SUPPORT_EMAIL: 'not-an-email', LEGAL_EFFECTIVE_DATE: 'soon' });
    assert.equal(config.operatorName, undefined);
    assert.equal(config.supportEmail, CONFIRMED_CONTACT_EMAIL); // a malformed override never replaces the confirmed mailbox
    assert.equal(config.effectiveDate, undefined);
  });

  it('shows exactly the configured values, in order', () => {
    const config = readLegalOperatorConfig({
      LEGAL_OPERATOR_NAME: 'Example Co.',
      LEGAL_BUSINESS_REGISTRATION_NUMBER: '000-00-00000',
      LEGAL_BUSINESS_ADDRESS: 'Seoul',
      LEGAL_SUPPORT_EMAIL: 'help@example.test',
      LEGAL_EFFECTIVE_DATE: '2026-11-01',
    });
    assert.deepEqual(operatorFacts(config).map(f => f.label), ['서비스', '운영자', '사업자등록번호', '사업장 주소']);
    assert.match(text(accountDeletionDocument(config)), /help@example\.test/);
    assert.equal(config.effectiveDate, '2026-11-01');
    assert.equal(formatLegalDate('2026-11-01'), '2026년 11월 1일');
  });
});

describe('legal text', () => {
  it('never publishes a placeholder or an internal review marker', () => {
    for (const doc of docs()) {
      assert.doesNotMatch(text(doc), /REVIEW REQUIRED|DECISION|\[날짜\]|\[N\]|TODO|example\.com/i, doc.slug);
    }
  });

  it('publishes only the confirmed mailbox', () => {
    for (const doc of docs()) {
      const mailboxes = text(doc).match(/[^\s@]+@[^\s@]+/g) ?? [];
      assert.ok(mailboxes.every(m => m.startsWith('jupleinfo@gmail.com')), doc.slug);
    }
    assert.match(text(privacyDocument(noOperator)), /jupleinfo@gmail\.com/);
  });

  it('account deletion offers a clear e-mail request path for people who cannot use the app', () => {
    const deletion = text(accountDeletionDocument(noOperator));
    for (const phrase of ['jupleinfo@gmail.com', 'Juple 계정 삭제 요청', '가입과 로그인에 사용한 이메일 주소', 'Juple ID', '앱을 사용할 수 없는 경우']) {
      assert.ok(deletion.includes(phrase), phrase);
    }
    assert.doesNotMatch(deletion, /다시 설치하고/);
  });

  it('states the approved retention periods', () => {
    const privacy = text(privacyDocument(noOperator));
    for (const phrase of ['24개월', '180일', '최대 5년', '90일', '30일', '최대 100개', '최대 30일']) {
      assert.ok(privacy.includes(phrase), phrase);
    }
    const deletion = text(accountDeletionDocument(noOperator));
    for (const phrase of ['24개월', '180일', '최대 5년', '30일']) {
      assert.ok(deletion.includes(phrase), phrase);
    }
  });

  it('describes the real in-app deletion path', () => {
    const deletion = text(accountDeletionDocument(noOperator));
    for (const phrase of ['내 페이지', '계정 관리', '계정 삭제 계속', '다시 로그인', 'Juple ID', '계정 영구 삭제']) {
      assert.ok(deletion.includes(phrase), phrase);
    }
  });

  it('account deletion keeps the full-account request and the data-only request clearly apart', () => {
    const doc = accountDeletionDocument(noOperator);
    const full = doc.sections.find(s => s.id === 'cannot-use-app');
    const dataOnly = doc.sections.find(s => s.id === 'data-only');
    assert.ok(full && dataOnly);
    const fullText = text({ ...doc, sections: [full] });
    const dataText = text({ ...doc, sections: [dataOnly] });
    assert.match(fullText, /계정 전체/);
    assert.match(fullText, /Juple 계정 삭제 요청/);
    assert.match(dataText, /계정을 유지하면서 데이터 삭제하기/);
    assert.match(dataText, /Juple 데이터 삭제 요청/);
    for (const phrase of ['jupleinfo@gmail.com', '가입에 사용한 이메일', 'Juple ID', '삭제를 원하는 데이터의 범위', '추가 정보를 요청', '계정은 유지']) {
      assert.ok(dataText.includes(phrase), phrase);
    }
    assert.doesNotMatch(dataText, /Juple 계정 삭제 요청/);
    assert.doesNotMatch(fullText, /Juple 데이터 삭제 요청/);
  });

  it('account deletion also deletes the sign-in account (v26) - no page says it is kept, and no Microsoft-internal timing is promised', () => {
    const privacy = text(privacyDocument(noOperator));
    const deletion = text(accountDeletionDocument(noOperator));
    for (const doc of [privacy, deletion]) {
      assert.doesNotMatch(doc, /지워지지 않습니다/);
      assert.doesNotMatch(doc, /30일 동안 복구|휴지통|soft delete/i);
    }
    assert.match(privacy, /계정 삭제를 요청하면 Juple 서비스에 사용하던 Microsoft Entra External ID 로그인 계정\(이메일 주소 등 로그인 정보\)의 삭제 절차도 함께 진행됩니다/);
    assert.match(privacy, /계정 삭제를 요청하면 Juple에서 쓰던 로그인 계정의 삭제도 함께 처리합니다/);
    const deleted = accountDeletionDocument(noOperator).sections.find(section => section.id === 'deleted');
    const kept = accountDeletionDocument(noOperator).sections.find(section => section.id === 'kept');
    assert.match(JSON.stringify(deleted), /Juple 서비스에 사용하던 로그인 계정/);
    assert.doesNotMatch(JSON.stringify(kept), /로그인 계정 정보/);
  });

  it('the trial memory is described as a one-way transformation of the sign-in email, never the email itself', () => {
    const privacy = text(privacyDocument(noOperator));
    const deletion = text(accountDeletionDocument(noOperator));
    assert.match(privacy, /로그인 이메일 주소를 정해진 방식으로 정리한 뒤 원래 값으로 되돌릴 수 없게 바꾼 변환값\(해시\)과 이용 기간을 저장합니다\. 이 기록에는 이메일 주소 자체를 저장하지 않습니다/);
    assert.match(deletion, /이메일 주소 자체나 이름은 남지 않습니다\. 이용 기간 종료 후 24개월까지 보관합니다/);
  });

  it('makes no "no analytics at all" claim', () => {
    assert.doesNotMatch(text(privacyDocument(noOperator)), /분석.*(하지 않|없)|analytics/i);
  });

  it('discloses the service usage record exactly: what is kept, what is not, why, for how long and on deletion', () => {
    const privacy = privacyDocument(noOperator);
    const section = (id: string) => text({ ...privacy, title: '', description: '', intro: '', sections: privacy.sections.filter(s => s.id === id) });
    const collected = section('collected');
    for (const phrase of ['서비스 이용 기록', '이용한 날짜(UTC 기준)', '이용 플랫폼(Android·iOS·웹)', '앱 빌드 번호', '최초·마지막 이용 시각']) {
      assert.ok(collected.includes(phrase), phrase);
    }
    // Precisely what is NOT kept - never a broad "no device information" (platform and build ARE kept).
    for (const phrase of ['원본 IP 주소', '전체 User-Agent 문자열', '정확한 위치정보', '기기 고유 식별값']) {
      assert.ok(collected.includes(phrase), phrase);
    }
    assert.doesNotMatch(collected, /기기 정보를 저장하지 않/);
    assert.match(section('purpose'), /서비스 이용 통계 작성과 개선: 일간·주간·월간 이용자 수, 플랫폼별 이용 현황/);
    assert.doesNotMatch(section('purpose'), /광고|마케팅/);
    // Its own retention line, separate from the 30-day operating logs, and no fixed period that is not enforced.
    const retention = section('retention');
    assert.ok(retention.includes('운영 로그: 최대 30일'));
    assert.ok(retention.includes('서비스 이용 기록(운영 로그와 별도): 회원 계정을 유지하는 동안 보관하며, 계정 삭제 시 함께 삭제'));
    assert.doesNotMatch(retention, /서비스 이용 기록[^\n]*13개월/);
    assert.match(section('account-deletion'), /해당 계정에 연결된 서비스 이용 기록도 함께 삭제됩니다/);
    assert.match(privacy.intro, /광고 목적의 행동 추적을 하지 않으며/);
  });

  it('dates each document on its own: the policy change does not re-date the terms or the deletion page', () => {
    assert.equal(privacyDocument(noOperator).updated, '2026-10-25');
    assert.equal(termsDocument(noOperator).updated, '2026-10-25');
    assert.equal(accountDeletionDocument(noOperator).updated, '2026-10-14');
  });

  it('gives every section a unique anchor id', () => {
    for (const doc of docs()) {
      const ids = doc.sections.map(s => s.id);
      assert.equal(new Set(ids).size, ids.length, doc.slug);
    }
  });
});

describe('metadata and headers', () => {
  it('is indexable with a canonical URL on the request host', () => {
    const meta = buildLegalMetadata(privacyDocument(noOperator), 'dev.juple.co.kr');
    assert.deepEqual(meta.robots, { index: true, follow: true });
    assert.equal(meta.alternates?.canonical, 'https://dev.juple.co.kr/privacy');
    assert.ok(meta.title && meta.description);
  });

  it('omits the canonical link when the host is unusable', () => {
    assert.equal(buildLegalMetadata(termsDocument(noOperator), null).alternates, undefined);
  });

  it('legal pages drop only the noindex header; the share viewer keeps it', () => {
    assert.ok(securityHeaders.some(h => h.key === 'X-Robots-Tag'));
    assert.ok(!legalSecurityHeaders.some(h => h.key === 'X-Robots-Tag'));
    assert.equal(legalSecurityHeaders.length, securityHeaders.length - 1);
  });
});

it('restricts account use to age 14 and over in both public policies', () => {
  for (const doc of [termsDocument(noOperator), privacyDocument(noOperator)]) {
    assert.match(text(doc), /만 14세 이상/);
    assert.match(text(doc), /만 14세 미만/);
  }
});
