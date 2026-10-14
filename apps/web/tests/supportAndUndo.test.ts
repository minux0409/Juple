import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { activeSettingsItem } from '../lib/settingsNav.ts';
import {
  canSubmitInquiry,
  formatInquiryDateTime,
  inquiryDiagnostics,
  inquiryListPath,
  inquiryPath,
  inquiryPreview,
  inquiryStatusLabel,
  inquiryTypeLabel,
  isInquiryNotFound,
  parseInquiry,
  parseInquiryId,
  parseInquiryPage,
  submissionAttempt,
  SUPPORT_INQUIRY_MAX_LENGTH,
  SUPPORT_INQUIRY_TYPES,
} from '../lib/support.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('customer center: inquiries on the Web (the mobile feature, same API)', () => {
  const dictionary = getAppDictionary('ko');

  it('uses the mobile endpoints and types', () => {
    assert.equal(inquiryListPath(null), '/api/v1/support/inquiries?limit=20');
    assert.equal(inquiryListPath('abc'), '/api/v1/support/inquiries?cursor=abc&limit=20');
    assert.equal(inquiryPath(9), '/api/v1/support/inquiries/9');
    assert.deepEqual([...SUPPORT_INQUIRY_TYPES], ['Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other']);
    assert.equal(SUPPORT_INQUIRY_MAX_LENGTH, 4000);
  });

  it('the mailto is gone: no mail program is the support flow', () => {
    const center = source('app/(app)/me/support/CustomerCenter.tsx');
    assert.doesNotMatch(center, /mailto:/);
    assert.match(center, /href="\/me\/support\/new"/);
    assert.match(source('app/(app)/me/support/page.tsx'), /<CustomerCenter \/>/);
  });

  it('a type and non-blank text are required, nothing while sending, and never over the limit', () => {
    assert.equal(canSubmitInquiry(null, 'hello', false), false);
    assert.equal(canSubmitInquiry('Bug', '   \n ', false), false);
    assert.equal(canSubmitInquiry('Bug', 'hello', false), true);
    assert.equal(canSubmitInquiry('Bug', 'hello', true), false, 'a double click cannot send twice');
    assert.equal(canSubmitInquiry('Bug', 'x'.repeat(SUPPORT_INQUIRY_MAX_LENGTH), false), true);
    assert.equal(canSubmitInquiry('Bug', 'x'.repeat(SUPPORT_INQUIRY_MAX_LENGTH + 1), false), false);
  });

  it('a retry of the same text is the same submission (one request id); changed text or type is a new one', () => {
    let counter = 0;
    const newId = () => `id-${++counter}`;
    const first = submissionAttempt(null, 'Bug', 'hello', newId);
    assert.equal(submissionAttempt(first, 'Bug', 'hello', newId).id, first.id);
    assert.notEqual(submissionAttempt(first, 'Bug', 'hello!', newId).id, first.id);
    assert.notEqual(submissionAttempt(first, 'Other', 'hello', newId).id, first.id);
  });

  it('the form holds the draft on failure and sends the request once (guard + attempt reuse)', () => {
    const form = source('app/(app)/me/support/new/NewInquiry.tsx');
    assert.match(form, /if \(sending\.current \|\| type === null/);
    assert.match(form, /submissionAttempt\(attempt\.current/);
    // The draft is cleared only by leaving the page after the server answered - a failure sets an error and keeps the text.
    assert.match(form, /setFailed\(true\)/);
    assert.doesNotMatch(form, /setContent\(''\)/);
    assert.match(form, /htmlFor=\{typeId\}/);
    assert.match(form, /htmlFor=\{contentId\}/);
    assert.match(form, /role="alert"/);
  });

  it('sends no identity: the body is the request id, the type, the text and browser facts only', () => {
    const form = source('app/(app)/me/support/new/NewInquiry.tsx');
    assert.doesNotMatch(form, /userId|jupleId|accountId/i);
    assert.deepEqual(inquiryDiagnostics(' ko-KR '), { platform: 'web', locale: 'ko-KR' });
    assert.deepEqual(inquiryDiagnostics(undefined), { platform: 'web', locale: null });
  });

  it('the list row: preview on one line, status spelled out in words', () => {
    assert.equal(inquiryPreview('  hello\n\nworld   again '), 'hello world again');
    assert.equal(inquiryPreview('a'.repeat(200)).length, 91);
    assert.equal(inquiryStatusLabel('Pending', dictionary), dictionary.inquiryStatusPending);
    assert.equal(inquiryStatusLabel('Answered', dictionary), dictionary.inquiryStatusAnswered);
    assert.notEqual(dictionary.inquiryStatusPending, dictionary.inquiryStatusAnswered);
    for (const type of SUPPORT_INQUIRY_TYPES) {
      assert.ok(inquiryTypeLabel(type, dictionary).length > 0);
    }
  });

  it('reads pages defensively: a malformed row is dropped, an empty / garbage page is an empty list', () => {
    const good = { inquiryId: 1, type: 'Bug', status: 'Answered', content: 'hi', createdAtUtc: '2026-10-14T00:00:00Z', answer: 'ok', answeredAtUtc: '2026-10-15T00:00:00Z' };
    const page = parseInquiryPage({ items: [good, { inquiryId: 'x' }, null, { ...good, inquiryId: 2, type: 'Hacked' }], nextCursor: '5' });
    assert.deepEqual(page.items.map(item => item.inquiryId), [1]);
    assert.equal(page.nextCursor, '5');
    assert.deepEqual(parseInquiryPage(undefined), { items: [], nextCursor: null });
    assert.equal(parseInquiryPage({ items: [], nextCursor: '' }).nextCursor, null);
    assert.equal(parseInquiry({ ...good, status: 'Weird' }), null);
  });

  it('answered vs not answered and unauthorized / not found', () => {
    const pending = parseInquiry({ inquiryId: 3, type: 'Other', status: 'Pending', content: 'q', createdAtUtc: '2026-10-14T00:00:00Z', answer: null, answeredAtUtc: null });
    assert.equal(pending?.answer, null);
    const detail = source('app/(app)/me/support/[inquiryId]/InquiryDetail.tsx');
    assert.match(detail, /data-inquiry-awaiting/);
    assert.match(detail, /data-inquiry-answer/);
    // someone else's id and a missing one are the same 404 - the page says only "not found"
    assert.equal(isInquiryNotFound(new ApiHttpError(404, null)), true);
    assert.equal(isInquiryNotFound(new ApiHttpError(403, null)), false);
    assert.equal(isInquiryNotFound(new Error('network')), false);
    assert.match(detail, /isInquiryNotFound\(caught\) \? \{ kind: 'notFound' \}/);
    // the session ending is handled like everywhere else, not shown as an error
    assert.match(detail, /isSessionLost\(caught\)/);
  });

  it('the page address is a plain positive integer or nothing (never a path built from free text)', () => {
    assert.equal(parseInquiryId('12'), 12);
    for (const bad of ['0', '-1', '1.5', '01', '1e3', '../x', '12/13', '', ' 1', '99999999999999999999', null, undefined]) {
      assert.equal(parseInquiryId(bad as string | null | undefined), null, String(bad));
    }
  });

  it('an inquiry and an answer are rendered as text, never markup', () => {
    for (const file of ['app/(app)/me/support/[inquiryId]/InquiryDetail.tsx', 'app/(app)/me/support/CustomerCenter.tsx', 'app/(app)/me/support/new/NewInquiry.tsx']) {
      assert.doesNotMatch(source(file), /dangerouslySetInnerHTML/, file);
    }
    assert.match(source('app/(app)/app.module.css'), /\.inquiryText \{[^}]*white-space: pre-wrap/);
  });

  it('the pages are inside 고객센터 (the settings frame highlights it)', () => {
    assert.equal(activeSettingsItem('/me/support')?.key, 'support');
    assert.equal(activeSettingsItem('/me/support/new')?.key, 'support');
    assert.equal(activeSettingsItem('/me/support/15')?.key, 'support');
    assert.equal(activeSettingsItem('/me/support-other'), null);
  });

  it('formats a date in the language and survives a bad value', () => {
    assert.match(formatInquiryDateTime('2026-10-14T03:04:00Z', 'en'), /2026/);
    assert.equal(formatInquiryDateTime('not a date', 'en'), '');
    assert.ok(formatInquiryDateTime('2026-10-14T03:04:00Z', 'invalid-locale-xx!!').length > 0);
  });
});

describe('strings: the new keys exist in every one of the 17 languages, and the table matches its generator', () => {
  it('every language has the inquiry and toast strings (mobile text, English where a language lacks one)', () => {
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['inquiryTabWrite', 'inquirySubmit', 'inquiryAwaitingAnswer', 'inquiryNotFound', 'toastDeleted', 'toastUndoDeleteError', 'toastRemovedFromCollection', 'toastMoved', 'undoAction'] as const) {
        assert.ok(String(dictionary[key]).length > 0, `${language}.${key}`);
      }
    }
  });

  it('lib/appI18nMobile.generated.ts is exactly what the generator writes for the mapped keys', () => {
    const result = spawnSync(process.execPath, ['scripts/generateMobileStrings.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
