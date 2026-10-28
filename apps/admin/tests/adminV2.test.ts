import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  LANGUAGES,
  answerBlocker,
  answerSendBody,
  applyTranslation,
  costCurrencies,
  customPeriodProblem,
  editTranslation,
  formatDay,
  formatMoney,
  inquiryLanguage,
  languageName,
  languagesToRefresh,
  monthlyValues,
  nextSort,
  noticeFingerprint,
  noticeLanguageState,
  pageCount,
  parseInquiryFilterV2,
  parseMetric,
  periodQuery,
  seoulToday,
  serviceTotals,
  sortDirection,
  translationErrorLabel,
  updatePolicyText,
  v2Paths,
  type AnswerDraftState,
  type CostHistory,
  type NoticeTextV2,
} from '../lib/adminV2.ts';
import { compactNumber, indexAt, labelIndexes, niceMax, niceMin, plot } from '../lib/charts.ts';

describe('admin V2 model', () => {
  it('ships exactly the 17 app languages, Korean first, with Korean display names', () => {
    assert.equal(LANGUAGES.length, 17);
    assert.equal(LANGUAGES[0], 'ko');
    for (const code of LANGUAGES) {
      assert.ok(existsSync(new URL(`../../mobile/src/i18n/locales/${code}.json`, import.meta.url)), code);
      assert.notEqual(languageName(code), code, code);
    }
    assert.equal(languageName('zh'), '중국어');
    assert.equal(languageName('xx'), 'xx');
    assert.equal(languageName(null), '알 수 없음');
  });

  it('reads today in Seoul whatever the browser time zone, and checks custom periods like the API', () => {
    assert.equal(seoulToday(new Date('2026-10-27T15:30:00Z')), '2026-10-28');
    assert.equal(seoulToday(new Date('2026-10-27T14:59:00Z')), '2026-10-27');
    assert.equal(customPeriodProblem('2026-10-01', '2026-10-28', '2026-10-28'), null);
    assert.match(customPeriodProblem('2026-10-29', '2026-10-28', '2026-10-28')!, /늦습니다/);
    assert.match(customPeriodProblem('2026-10-01', '2026-10-29', '2026-10-28')!, /이후/);
    assert.match(customPeriodProblem('2025-01-01', '2026-10-28', '2026-10-28')!, /366/);
    assert.equal(customPeriodProblem('2025-10-28', '2026-10-28', '2026-10-28'), null);
    assert.match(customPeriodProblem('', '2026-10-28', '2026-10-28')!, /선택/);
    assert.equal(periodQuery({ range: '7d' }), 'range=7d');
    assert.equal(periodQuery({ range: 'custom', from: '2026-10-01', through: '2026-10-28' }), 'from=2026-10-01&through=2026-10-28');
  });

  it('formats Seoul days without a time-zone shift, and money in its own currency', () => {
    assert.equal(formatDay('2026-01-01'), '1월 1일');
    assert.equal(formatDay('2026-01-01', true), '2026년 1월 1일');
    assert.equal(formatMoney(12345.6, 'KRW'), '₩12,346');
    assert.match(formatMoney(1.5, 'USD'), /1\.50/);
    assert.equal(formatMoney(3, 'XX!'), '3 XX!');
  });

  it('builds every V2 path under /api/v1/admin with encoded values', () => {
    assert.equal(v2Paths.series('links', { range: '90d' }), '/api/v1/admin/dashboard/series?metric=links&range=90d');
    assert.equal(
      v2Paths.users({ search: ' K7 ', searchField: 'jupleId', language: 'ko', sort: 'linksDesc', page: 2, pageSize: 20 }),
      '/api/v1/admin/users/directory?sort=linksDesc&page=2&pageSize=20&search=K7&searchField=jupleId&language=ko',
    );
    assert.equal(v2Paths.users({ search: '', searchField: 'nickname', language: '', sort: 'createdDesc', page: 1, pageSize: 20 }), '/api/v1/admin/users/directory?sort=createdDesc&page=1&pageSize=20');
    assert.equal(v2Paths.inquiries('Open', null), '/api/v1/admin/support/inquiries?status=Open');
    assert.equal(v2Paths.inquiries('all', '12'), '/api/v1/admin/support/inquiries?cursor=12');
    const query = { search: '', searchField: 'jupleId', language: '', sort: 'createdDesc', page: 1, pageSize: 20 } as const;
    const built = Object.entries(v2Paths).map(([name, value]) =>
      typeof value === 'string' ? value
      : name === 'series' ? v2Paths.series('users', { range: '7d' })
      : name === 'users' ? v2Paths.users(query)
      : name === 'userHistory' ? v2Paths.userHistory(1, 'day')
      : name === 'inquiries' ? v2Paths.inquiries('Open', null)
      : name === 'costHistory' ? v2Paths.costHistory('6')
      : (value as (id: number) => string)(7));
    for (const path of built) {
      assert.ok(path.startsWith('/api/v1/admin/'), path);
    }
    assert.equal(parseMetric('links'), 'links');
    assert.equal(parseMetric('revenue'), 'users');
    assert.equal(parseInquiryFilterV2(null), 'Open');
    assert.equal(parseInquiryFilterV2('Answered'), 'Answered');
  });

  it('sorts the user table newest/most first, then the reverse', () => {
    assert.equal(nextSort('createdDesc', 'created'), 'createdAsc');
    assert.equal(nextSort('createdAsc', 'created'), 'createdDesc');
    assert.equal(nextSort('createdDesc', 'links'), 'linksDesc');
    assert.equal(nextSort('linksDesc', 'links'), 'linksAsc');
    assert.equal(sortDirection('linksAsc', 'links'), 'ascending');
    assert.equal(sortDirection('linksAsc', 'created'), 'none');
    assert.equal(pageCount(0, 20), 1);
    assert.equal(pageCount(41, 20), 3);
  });
});

describe('notice translations', () => {
  it('computes the same fingerprint as the API (pinned in AdminTranslationTests)', async () => {
    assert.equal(await noticeFingerprint(' 점검 안내 ', '내일 점검합니다\n'), 'f75afad82792cfbe649659ebc7b5b48a46aec9f5ccc82db05123da4b0a71414a');
  });

  it('tells source, missing, machine, stale, manual and failed apart', () => {
    const fp = 'a'.repeat(64);
    assert.equal(noticeLanguageState({ language: 'ko', title: 't', body: 'b' }, fp, false), 'source');
    assert.equal(noticeLanguageState(undefined, fp, false), 'missing');
    assert.equal(noticeLanguageState(undefined, fp, true), 'failed');
    assert.equal(noticeLanguageState({ language: 'en', title: 't', body: 'b', origin: 'Machine', sourceFingerprint: fp }, fp, false), 'machine');
    assert.equal(noticeLanguageState({ language: 'en', title: 't', body: 'b', origin: 'Machine', sourceFingerprint: 'b'.repeat(64) }, fp, false), 'stale');
    assert.equal(noticeLanguageState({ language: 'en', title: 't', body: 'b', origin: 'Manual' }, fp, false), 'manual');
    // An older notice without recorded origin is treated as hand-written - never overwritten automatically.
    assert.equal(noticeLanguageState({ language: 'en', title: 't', body: 'b' }, fp, false), 'manual');
  });

  it('refreshes only missing, failed and stale machine translations - never a manual one', () => {
    const fp = 'a'.repeat(64);
    const texts: NoticeTextV2[] = [
      { language: 'ko', title: '제목', body: '본문', origin: 'Source' },
      { language: 'en', title: 'T', body: 'B', origin: 'Machine', sourceFingerprint: fp },
      { language: 'ja', title: 'T', body: 'B', origin: 'Machine', sourceFingerprint: 'b'.repeat(64) },
      { language: 'fr', title: 'T', body: 'B', origin: 'Manual' },
    ];
    const refresh = languagesToRefresh(texts, fp, new Set(['de']));
    assert.ok(refresh.includes('ja'));
    assert.ok(refresh.includes('de'));
    assert.ok(refresh.includes('es'));
    assert.ok(!refresh.includes('en'));
    assert.ok(!refresh.includes('fr'));
    assert.ok(!refresh.includes('ko'));
    assert.equal(refresh.length, 14);
  });

  it('a translation result becomes Machine; editing it by hand makes it Manual; a failure changes nothing', () => {
    const fp = 'c'.repeat(64);
    let texts: NoticeTextV2[] = [{ language: 'ko', title: '제목', body: '본문', origin: 'Source' }];
    texts = applyTranslation(texts, { language: 'en', status: 'translated', title: 'Title', body: 'Body', errorCode: null }, fp);
    assert.deepEqual(texts[1], { language: 'en', title: 'Title', body: 'Body', origin: 'Machine', sourceFingerprint: fp });
    assert.deepEqual(applyTranslation(texts, { language: 'ja', status: 'failed', title: null, body: null, errorCode: 'throttled' }, fp), texts);
    texts = editTranslation(texts, 'en', 'title', 'Edited');
    assert.deepEqual(texts[1], { language: 'en', title: 'Edited', body: 'Body', origin: 'Manual', sourceFingerprint: null });
    texts = editTranslation(texts, 'ko', 'body', '새 본문');
    assert.equal(texts[0].origin, 'Source');
  });

  it('names every provider failure, never as a success', () => {
    assert.match(translationErrorLabel('translationNotConfigured'), /설정되지/);
    assert.match(translationErrorLabel('translation_throttled'), /제한/);
    assert.match(translationErrorLabel('somethingNew'), /somethingNew/);
    assert.match(translationErrorLabel(null), /번역하지 못했습니다/);
  });
});

describe('inquiry answers', () => {
  const base: AnswerDraftState = { language: 'en', sourceKo: '수정했습니다', translated: 'We fixed it', translatedFrom: '수정했습니다', manualConfirmed: false };

  it('a translated answer can be sent only with a translation of the CURRENT Korean text (or an explicit confirmation)', () => {
    assert.equal(answerBlocker(base), null);
    assert.match(answerBlocker({ ...base, sourceKo: '' })!, /한국어/);
    assert.match(answerBlocker({ ...base, translated: ' ' })!, /번역문이 없습니다/);
    assert.match(answerBlocker({ ...base, sourceKo: '수정했습니다. 감사합니다' })!, /현재 한국어/);
    assert.equal(answerBlocker({ ...base, sourceKo: '수정했습니다. 감사합니다', manualConfirmed: true }), null);
    assert.equal(answerBlocker({ ...base, translatedFrom: null, manualConfirmed: true }), null);
    assert.equal(answerBlocker({ ...base, language: 'ko', translated: '' }), null);
  });

  it('sends what the person reads, its Korean original, the language and the change token', () => {
    assert.deepEqual(answerSendBody(base, '2026-10-28T00:00:00+00:00'), {
      answer: 'We fixed it',
      sourceKo: '수정했습니다',
      language: 'en',
      expectedUpdatedAtUtc: '2026-10-28T00:00:00+00:00',
    });
    assert.equal(answerSendBody({ ...base, language: 'ko' }, 't').answer, '수정했습니다');
  });

  it('shows the detected language, else the device locale', () => {
    assert.equal(inquiryLanguage({ contentLanguage: 'ja', locale: 'en-US' }), '일본어');
    assert.equal(inquiryLanguage({ contentLanguage: null, locale: 'en-US' }), '영어 (기기 설정)');
    assert.equal(inquiryLanguage({ contentLanguage: null, locale: null }), '알 수 없음');
  });
});

describe('costs and app versions', () => {
  const history: CostHistory = {
    scope: '/subscriptions/x/resourceGroups/rg',
    environment: 'PROD',
    todayUtc: '2026-10-28',
    months: [
      { month: '2026-08-01', isCurrent: false, synced: true, lastSyncAtUtc: 'x', syncStatus: 'Succeeded', failureCode: null, amounts: [{ currency: 'KRW', amount: 70 }] },
      { month: '2026-09-01', isCurrent: false, synced: false, lastSyncAtUtc: null, syncStatus: 'Never', failureCode: null, amounts: [] },
      { month: '2026-10-01', isCurrent: true, synced: true, lastSyncAtUtc: 'x', syncStatus: 'Succeeded', failureCode: null, amounts: [{ currency: 'KRW', amount: 120 }, { currency: 'USD', amount: 1.5 }] },
    ],
  };

  it('keeps an unsynced month unknown (null) and never converts or adds currencies', () => {
    assert.deepEqual(costCurrencies(history), ['KRW', 'USD']);
    assert.deepEqual(monthlyValues(history, 'KRW'), [70, null, 120]);
    assert.deepEqual(monthlyValues(history, 'USD'), [0, null, 1.5]);
  });

  it('sums a month of daily service rows per service and currency', () => {
    const totals = serviceTotals({
      scope: 's', month: '2026-10-01', through: '2026-10-28', lastSyncAtUtc: null, syncStatus: 'Succeeded', failureCode: null, totals: [],
      services: [
        { date: '2026-10-01', label: 'SQL Database', currency: 'KRW', amount: 10 },
        { date: '2026-10-02', label: 'SQL Database', currency: 'KRW', amount: 15 },
        { date: '2026-10-01', label: 'Storage', currency: 'KRW', amount: 30 },
      ],
    });
    assert.deepEqual(totals, [
      { service: 'Storage', currency: 'KRW', amount: 30, days: 1 },
      { service: 'SQL Database', currency: 'KRW', amount: 25, days: 2 },
    ]);
  });

  it('describes the update policy with the apps\' own rules', () => {
    assert.equal(updatePolicyText(34, 24), '빌드 24 미만: 강제 업데이트 · 24~33: 업데이트 안내 · 34 이상: 안내 없음');
    assert.equal(updatePolicyText(34, 34), '빌드 34 미만: 강제 업데이트 · 34 이상: 안내 없음');
    assert.match(updatePolicyText(0, 0), /정책 없음/);
  });
});

describe('charts', () => {
  it('rounds the axis maximum and keeps a cumulative line readable', () => {
    assert.equal(niceMax(0), 1);
    assert.equal(niceMax(7), 10);
    assert.equal(niceMax(13), 20);
    assert.equal(niceMax(24), 25);
    assert.equal(niceMin([1000, 1010, 1020]), 990);
    assert.equal(niceMin([0, 5]), 0);
    assert.equal(niceMin([null, null]), 0);
  });

  it('draws gaps for unmeasured values and places one point per slot', () => {
    const geometry = plot([1, 2, null, 4]);
    assert.equal(geometry.points.length, 4);
    assert.equal(geometry.points[2].y, null);
    assert.equal((geometry.line.match(/M/g) ?? []).length, 2);
    assert.equal(geometry.ticks[0].value, 0);
    assert.ok(geometry.points[0].x < geometry.points[1].x);
    assert.equal(plot([]).line, '');
  });

  it('maps a pointer to its point, labels about seven dates and shortens big numbers', () => {
    assert.equal(indexAt(48, 30), 0);
    assert.equal(indexAt(784, 30), 29);
    assert.equal(indexAt(10_000, 30), 29);
    assert.equal(indexAt(0, 0), -1);
    assert.deepEqual(labelIndexes(5), [0, 1, 2, 3, 4]);
    const many = labelIndexes(90);
    assert.equal(many[0], 0);
    assert.equal(many[many.length - 1], 89);
    assert.ok(many.length <= 7);
    assert.equal(compactNumber(1234), '1,234');
    assert.equal(compactNumber(25_000), '2.5만');
  });
});
