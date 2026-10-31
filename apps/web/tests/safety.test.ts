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
  reportPath,
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

  it('the Agreement: two required items with their details, all-agree, no skip, X leaves, 다음 only when both are checked', () => {
    const agreement = source('app/(app)/TermsAgreement.tsx');
    assert.match(agreement, /href="\/terms"/);
    assert.match(agreement, /href="\/privacy"/);
    assert.match(agreement, /disabled=\{busy \|\| !allChecked\}/);
    assert.match(agreement, /path: TERMS_ACCEPTANCE_PATH, body: \{ version, isAtLeast14: ageChecked \}/);
    // 전체동의 and the item component (used for the Terms and for the personal-information item); there is no "later" / skip
    assert.equal((agreement.match(/type="checkbox"/g) ?? []).length, 3);
    assert.equal((agreement.match(/<AgreementItem/g) ?? []).length, 2);
    assert.doesNotMatch(agreement, /onLater|safetyTermsLater/);
    assert.doesNotMatch(agreement, /agreement-close|onClose|agreementClose/);
    assert.doesNotMatch(agreement, /localStorage|sessionStorage/);
  });

  it('the app shows the Agreement INSTEAD of the shell until accepted, and again when the server asks for a newer version', () => {
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /parseTermsStatus\(result\?\.terms\)/);
    assert.match(root, /isTermsRequired\(error\)/);
    assert.match(root, /api && terms && !terms\.isAccepted/);
    assert.ok(root.indexOf('<TermsAgreement') < root.indexOf('<AppShell>'), 'the Agreement comes before the shell');
    assert.doesNotMatch(root, /termsAsked|TermsGate/);
  });
});

describe('reporting (the mobile reasons, the same API)', () => {
  it('offers the policy\'s five reasons, each with words in every language', () => {
    assert.deepEqual([...REPORT_REASONS], ['Spam', 'SexualOrInappropriate', 'Harassment', 'IntellectualProperty', 'Other']);
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const reason of REPORT_REASONS) {
        assert.ok(reportReasonLabel(reason, words).length > 0, `${language} ${reason}`);
      }
    }
  });

  it('builds the body: a person by Juple ID, the rest by id, an item through its Collection; blank details are left out', () => {
    assert.deepEqual(reportBody({ type: 'User', jupleId: 'ABCD2345' }, 'Spam', '   '), { targetType: 'User', targetId: 'ABCD2345', reason: 'Spam' });
    assert.deepEqual(reportBody({ type: 'Collection', collectionId: 4 }, 'Spam', ' why '), { targetType: 'Collection', targetId: '4', reason: 'Spam', details: 'why' });
    assert.deepEqual(reportBody({ type: 'Item', itemId: 9, collectionId: 4 }, 'Other', ''), { targetType: 'Item', targetId: '9', collectionId: 4, reason: 'Other' });
    assert.deepEqual(reportBody({ type: 'Comment', commentId: 7 }, 'Harassment', ''), { targetType: 'Comment', targetId: '7', reason: 'Harassment' });
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

  it("is offered on somebody else's comment, never on one's own (a friend has no 신고 / 차단 either)", () => {
    assert.match(source('app/(app)/ItemCollaboration.tsx'), /onReport && !author\.isMe/);
    assert.doesNotMatch(source('app/(app)/me/friends/page.tsx'), /safety\.(report|block)\(/);
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
    assert.match(provider, /<ConfirmDialog[\s\S]*destructive[\s\S]*dictionary\.safetyBlockConfirmMessage/);
    assert.match(provider, /method: 'POST', path: blockPath\(subject\.jupleId\)/);
    // Not a settings entry of its own and not a Friends tab: a link at the top of Friends opens the page, which lists and unblocks through the API.
    assert.doesNotMatch(source('lib/settingsNav.ts'), /blockedUsers/);
    assert.match(source('app/(app)/me/friends/page.tsx'), /href="\/me\/blocked-users"/);
    assert.match(source('app/(app)/me/blocked-users/page.tsx'), /method: 'DELETE', path: blockPath\(pending\.jupleId\)/);
  });

  it('every safety string exists in every language', () => {
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['agreementTitle', 'agreementAgreeAll', 'agreementNext', 'agreementPrivacyItemsBody', 'safetyReport', 'safetyReportSubmit', 'safetyReportReceived', 'safetyReportAlready', 'safetyBlock', 'safetyBlockTitle', 'safetyBlockConfirmMessage', 'safetyUnblock', 'safetyBlockedUsers', 'safetyBlockedUsersEmpty'] as const) {
        assert.ok(String(words[key]).length > 0, `${language}.${key}`);
      }
    }
  });
});

describe('the published Terms and Privacy Policy describe the safety features', () => {
  const config = { serviceName: 'Juple' } as Parameters<typeof termsDocument>[0];
  const text = (slug: 'terms' | 'privacy') =>
    JSON.stringify((slug === 'terms' ? termsDocument(config) : privacyDocument(config)).sections.map(section => [section.title, section.blocks]));

  it('Terms: forbidden content, reporting and blocking, and only the actions Juple really takes (no automatic moderation claim)', () => {
    const terms = text('terms');
    for (const word of ['불법 콘텐츠', '괴롭히거나', '스팸', '악성 링크', '사칭', '신고', '차단', '접근 제한', '계정 이용 제한 또는 정지']) {
      assert.ok(terms.includes(word), word);
    }
    // the moderation sections say nothing about automatic / AI moderation (the subscription's "자동 갱신" is a different thing)
    const moderation = JSON.stringify(termsDocument(config).sections.filter(section => ['conduct', 'reporting', 'restriction'].includes(section.id)));
    assert.doesNotMatch(moderation, /자동(으로)? ?(검토|삭제|차단|감지|탐지|제한)|AI|인공지능|알고리즘/);
  });

  it('Privacy: reports, blocks and the Terms acceptance record, with their purpose and no invented retention period', () => {
    const privacy = text('privacy');
    for (const word of ['신고', '차단 관계', '이용약관 동의', '서비스 안전']) {
      assert.ok(privacy.includes(word), word);
    }
    assert.doesNotMatch(privacy, /REVIEW REQUIRED|TODO/);
  });
});

describe('shared Collection reports, blocks and restriction on the Web', () => {
  it('a public link is reported through the link, with no internal id', () => {
    assert.equal(reportPath({ type: 'PublicShare', publicId: 'a/b' }), '/api/v1/public-shares/a%2Fb/reports');
    assert.equal(reportPath({ type: 'Collection', collectionId: 1 }), '/api/v1/reports');
    assert.deepEqual(reportBody({ type: 'PublicShare', publicId: 'x' }, 'Spam', ' why '), { reason: 'Spam', details: 'why' });
  });

  it('offers the policy\'s five reasons', () => {
    assert.deepEqual([...REPORT_REASONS], ['Spam', 'SexualOrInappropriate', 'Harassment', 'IntellectualProperty', 'Other']);
  });

  it('the anonymous page only leads to the signed-in entry; the entry reports, only for a public link', () => {
    assert.match(source('app/c/[publicId]/page.tsx'), /href=\{`\/shared\/\$\{encodeURIComponent\(publicId\)\}`\}/);
    assert.match(source('app/(app)/shared/[publicId]/SharedCollectionEntry.tsx'), /entry\.kind === 'publicAdd' \? \([\s\S]*type: 'PublicShare'/);
  });

  it('a link is reportable only when it is not mine; a participant can be blocked, never myself', () => {
    assert.match(source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx'), /!item\.isMine && collectionId !== null/);
    assert.match(source('app/(app)/collections/[collectionId]/CollectionSharing.tsx'), /person\.isMe \? undefined : <BlockPersonButton/);
  });

  it('a blocked person carries the hidden Collections still open to me', () => {
    const [person] = parseBlockedUsers({ items: [{ jupleId: 'AAAA2222', hiddenCollections: [{ id: 3, name: 'T' }, { id: 'x' }] }] });
    assert.deepEqual(person.hiddenCollections, [{ id: 3, name: 'T' }]);
  });
});
