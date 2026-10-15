import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { privacyDocument, termsDocument } from '../lib/legalContent.ts';
import {
  blockedInteractionMessage,
  blockPath,
  isTermsRequired,
  parseBlockedUsers,
  parseReportReceipt,
  parseTermsStatus,
  REPORT_REASONS,
  reportBody,
  reportReasonLabel,
} from '../lib/safety.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const dictionary = getAppDictionary('ko');

describe('Terms of Service acceptance', () => {
  it('reads the status the server sends, and nothing it does not understand', () => {
    assert.deepEqual(parseTermsStatus({ currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false }), { currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false });
    assert.equal(parseTermsStatus({ currentVersion: '', isAccepted: true }), null);
    assert.equal(parseTermsStatus(undefined), null);
    assert.equal(parseTermsStatus({ currentVersion: 'v', isAccepted: 'yes' }), null);
  });

  it('only termsAcceptanceRequired (403) asks for the agreement again', () => {
    assert.equal(isTermsRequired(new ApiHttpError(403, 'termsAcceptanceRequired')), true);
    assert.equal(isTermsRequired(new ApiHttpError(403, 'subscriptionRequired')), false);
    assert.equal(isTermsRequired(new ApiHttpError(409, 'termsAcceptanceRequired')), false);
    assert.equal(isTermsRequired(new Error('x')), false);
  });

  it('the gate: Terms and Privacy are links, only the Terms are agreed to, "not now" keeps the person signed in', () => {
    const gate = source('app/(app)/TermsGate.tsx');
    assert.match(gate, /href="\/terms"/);
    assert.match(gate, /href="\/privacy"/);
    assert.match(gate, /disabled=\{busy \|\| !agreed\}/);
    assert.match(gate, /path: TERMS_ACCEPTANCE_PATH, body: \{ version \}/);
    assert.match(gate, /onLater/);
    // one agreement, one checkbox - the Privacy Policy has none of its own and is not bundled
    assert.equal((gate.match(/type="checkbox"/g) ?? []).length, 1);
  });

  it('the app asks after sign-in and again when a write is refused; nothing is stored in the browser', () => {
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /parseTermsStatus\(result\?\.terms\)/);
    assert.match(root, /isTermsRequired\(error\)/);
    assert.match(root, /terms && !terms\.isAccepted && termsAsked/);
    assert.doesNotMatch(source('app/(app)/TermsGate.tsx'), /localStorage|sessionStorage/);
  });
});

describe('reporting (the mobile reasons, the same API)', () => {
  it('has exactly the server\'s eight reasons, each with words in every language', () => {
    assert.deepEqual([...REPORT_REASONS], ['Spam', 'Harassment', 'HateOrAbuse', 'SexualOrInappropriate', 'Illegal', 'ScamOrMaliciousLink', 'IntellectualProperty', 'Other']);
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const reason of REPORT_REASONS) {
        assert.ok(reportReasonLabel(reason, words).length > 0, `${language} ${reason}`);
      }
    }
  });

  it('builds the body: a person by Juple ID, the rest by id, an item through its Collection; blank details are left out', () => {
    assert.deepEqual(reportBody({ type: 'User', jupleId: 'ABCD2345' }, 'Spam', '   '), { targetType: 'User', targetId: 'ABCD2345', reason: 'Spam' });
    assert.deepEqual(reportBody({ type: 'Collection', collectionId: 4 }, 'Illegal', ' why '), { targetType: 'Collection', targetId: '4', reason: 'Illegal', details: 'why' });
    assert.deepEqual(reportBody({ type: 'Item', itemId: 9, collectionId: 4 }, 'Other', ''), { targetType: 'Item', targetId: '9', collectionId: 4, reason: 'Other' });
    assert.deepEqual(reportBody({ type: 'Comment', commentId: 7 }, 'HateOrAbuse', ''), { targetType: 'Comment', targetId: '7', reason: 'HateOrAbuse' });
  });

  it('reads the receipt', () => {
    assert.deepEqual(parseReportReceipt({ alreadyReported: true }), { alreadyReported: true });
    assert.deepEqual(parseReportReceipt({}), { alreadyReported: false });
    assert.deepEqual(parseReportReceipt(undefined), { alreadyReported: false });
  });

  it('the dialog: a reason is required (none pre-selected), details are plain text bounded to 1000, one send at a time', () => {
    const provider = source('app/(app)/SafetyProvider.tsx');
    assert.match(provider, /useState<ReportReason \| null>\(null\)/);
    assert.match(provider, /disabled=\{busy \|\| reason === null\}/);
    assert.match(provider, /maxLength=\{REPORT_DETAILS_MAX_LENGTH\}/);
    assert.match(provider, /sending\.current/);
    assert.doesNotMatch(provider, /dangerouslySetInnerHTML/);
  });

  it('is offered on somebody else\'s Collection, comment and friend - and never on one\'s own', () => {
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /isSharedWithMe\(collection\)\s*\? \[\{ key: 'report'/);
    assert.match(source('app/(app)/ItemCollaboration.tsx'), /onReport && !author\.isMe/);
    assert.match(source('app/(app)/me/friends/page.tsx'), /safety\.report\(\{ type: 'User', jupleId: friend\.jupleId \}\)/);
  });

  it('no anonymous reporting: the public-only viewer has no report call', () => {
    for (const file of ['app/c/[publicId]/page.tsx']) {
      try {
        assert.doesNotMatch(source(file), /\/api\/v1\/reports/);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    assert.doesNotMatch(source('lib/publicApi.ts'), /reports/);
  });
});

describe('blocking', () => {
  it('addresses a person by Juple ID only, escaped', () => {
    assert.equal(blockPath('ABCD2345'), '/api/v1/users/ABCD2345/block');
    assert.equal(blockPath('A/../B'), '/api/v1/users/A%2F..%2FB/block');
  });

  it('reads the blocked list defensively', () => {
    const users = parseBlockedUsers({ items: [{ jupleId: 'AAAA2222', displayName: ' ', blockedAtUtc: 't', profileImageUrl: null }, { jupleId: '' }, null, { jupleId: 'BBBB3333', displayName: 'Bo' }] });
    assert.deepEqual(users.map(user => user.jupleId), ['AAAA2222', 'BBBB3333']);
    assert.equal(users[0].displayName, null);
    assert.deepEqual(parseBlockedUsers('nope'), []);
  });

  it('words a block-refused interaction - and never says who blocked whom to the blocked', () => {
    assert.equal(blockedInteractionMessage(new ApiHttpError(403, 'userBlocked'), dictionary), dictionary.safetyUserBlockedByYou);
    assert.equal(blockedInteractionMessage(new ApiHttpError(403, 'interactionNotAllowed'), dictionary), dictionary.safetyInteractionNotAllowed);
    assert.equal(blockedInteractionMessage(new ApiHttpError(403, 'other'), dictionary), null);
    assert.equal(blockedInteractionMessage(new ApiHttpError(404, 'userBlocked'), dictionary), null);
    assert.doesNotMatch(getAppDictionary('en').safetyInteractionNotAllowed, /block/i);
  });

  it('asks before blocking, then blocks through the API; the list lives in settings with 차단 해제', () => {
    const provider = source('app/(app)/SafetyProvider.tsx');
    assert.match(provider, /<ConfirmDialog[\s\S]*destructive[\s\S]*dictionary\.safetyBlockMessage/);
    assert.match(provider, /method: 'POST', path: blockPath\(subject\.jupleId\)/);
    const page = source('app/(app)/me/blocked-users/BlockedUsers.tsx');
    assert.match(page, /method: 'DELETE', path: blockPath\(user\.jupleId\)/);
    assert.match(page, /data-unblock/);
    assert.match(source('lib/settingsNav.ts'), /key: 'blockedUsers', href: '\/me\/blocked-users'/);
  });

  it('every safety string exists in every language', () => {
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['safetyTermsTitle', 'safetyTermsBody', 'safetyTermsAgree', 'safetyReport', 'safetyReportSubmit', 'safetyReportReceived', 'safetyReportAlready', 'safetyBlock', 'safetyBlockTitle', 'safetyBlockMessage', 'safetyUnblock', 'safetyBlockedUsers', 'safetyBlockedUsersEmpty'] as const) {
        assert.ok(String(words[key]).length > 0, `${language}.${key}`);
      }
    }
  });
});

describe('the published Terms and Privacy Policy - UGC safety wording ships with the v26 rollout, not before', () => {
  // The report / block / Terms-consent wording (Terms 5-1, the expanded prohibited-conduct list and enforcement steps, the Privacy
  // safety records) is kept on the local branch wip/ugc-legal-prelaunch together with its original tests. It is published when the
  // v26 reporting / blocking features reach people; until then the published documents (the Production web) must not describe
  // features the store build does not have. Restore that branch's legalContent.ts hunks and its tests (which replace this one) then.
  const config = { serviceName: 'Juple' } as Parameters<typeof termsDocument>[0];
  const text = (slug: 'terms' | 'privacy') =>
    JSON.stringify((slug === 'terms' ? termsDocument(config) : privacyDocument(config)).sections.map(section => [section.title, section.blocks]));

  it('Terms: no reporting / blocking section and no enforcement steps that rely on reports yet', () => {
    assert.equal(termsDocument(config).sections.some(section => section.id === 'reporting'), false);
    const terms = text('terms');
    for (const word of ['신고와 차단', '차단한 사용자', '신고된 내용']) {
      assert.ok(!terms.includes(word), word);
    }
  });

  it('Privacy: no report / block / Terms-consent records yet', () => {
    const privacy = text('privacy');
    for (const word of ['서비스 안전', '차단 관계', '신고 기록', '이용약관 동의 기록']) {
      assert.ok(!privacy.includes(word), word);
    }
  });
});
