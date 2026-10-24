import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  NOTICE_LANGUAGES,
  adminNoticeListPath,
  publicationState,
} from '../lib/notices.ts';
it('supports all languages and safely encodes search/cursor filters', () => {
  assert.equal(NOTICE_LANGUAGES.length, 17);
  assert.equal(NOTICE_LANGUAGES[0], 'ko');
  const url = new URL(
    adminNoticeListPath('a&status=Draft', 'Published', '5'),
    'https://test.invalid',
  );
  assert.equal(url.searchParams.get('search'), 'a&status=Draft');
  assert.equal(url.searchParams.get('status'), 'Published');
  assert.equal(url.searchParams.get('cursor'), '5');
});
it('distinguishes drafts, schedules, ended and currently published notices', () => {
  const n = {
    status: 'Published' as const,
    startsAtUtc: '2026-10-25T00:00:00Z',
    endsAtUtc: null,
  };
  const now = Date.parse('2026-10-24T00:00:00Z');
  assert.equal(publicationState(n, now), '게시 예약');
  assert.equal(publicationState({ ...n, status: 'Draft' }, now), '초안 / 중단');
  assert.equal(
    publicationState({ ...n, startsAtUtc: '2026-10-23T00:00:00Z' }, now),
    '게시 중',
  );
  assert.equal(
    publicationState(
      { ...n, endsAtUtc: '2026-10-26T00:00:00Z' },
      Date.parse('2026-10-27T00:00:00Z'),
    ),
    '게시 종료',
  );
});
