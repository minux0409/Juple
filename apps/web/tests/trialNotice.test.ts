import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { describeTrialNotice, isTrialNoticeClosed, TRIAL_ENDING_REMINDER_MS, trialNoticeKey } from '../lib/trialNotice.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const NOW = Date.parse('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const trial = (endsInDays: number | null, overrides: Record<string, unknown> = {}) => ({
  programEnabled: true,
  status: 'trial' as const,
  trialEndsAtUtc: endsInDays === null ? null : new Date(NOW + endsInDays * DAY).toISOString(),
  ...overrides,
});

describe('the free-period notice', () => {
  it('says nothing while the program is off, for a subscriber, an expired account, a missing / bad / past end date', () => {
    assert.equal(describeTrialNotice(null, NOW), null);
    assert.equal(describeTrialNotice(trial(20, { programEnabled: false }), NOW), null);
    assert.equal(describeTrialNotice(trial(20, { status: 'active' }), NOW), null);
    assert.equal(describeTrialNotice(trial(20, { status: 'expired' }), NOW), null);
    assert.equal(describeTrialNotice(trial(20, { status: null }), NOW), null);
    assert.equal(describeTrialNotice(trial(null), NOW), null);
    assert.equal(describeTrialNotice(trial(20, { trialEndsAtUtc: 'x' }), NOW), null);
    assert.equal(describeTrialNotice(trial(-1), NOW), null);
  });

  it('welcomes a trial with more than 7 days left and reminds in the last 7; the date is the server\'s', () => {
    assert.equal(describeTrialNotice(trial(29), NOW)?.kind, 'welcome');
    assert.equal(describeTrialNotice(trial(7), NOW)?.kind, 'endingSoon');
    assert.equal(describeTrialNotice(trial(1), NOW)?.endsAtUtc, new Date(NOW + DAY).toISOString());
  });

  it('the welcome stays closed for good; the reminder comes back after a day; another trial is not affected', () => {
    const welcome = describeTrialNotice(trial(29), NOW)!;
    const ending = describeTrialNotice(trial(3), NOW)!;
    assert.equal(isTrialNoticeClosed(welcome, null, NOW), false);
    assert.equal(isTrialNoticeClosed(welcome, String(NOW), NOW + 25 * DAY), true);
    assert.equal(isTrialNoticeClosed(ending, String(NOW), NOW + TRIAL_ENDING_REMINDER_MS - 1), true);
    assert.equal(isTrialNoticeClosed(ending, String(NOW), NOW + TRIAL_ENDING_REMINDER_MS + 1), false);
    assert.notEqual(trialNoticeKey(welcome), trialNoticeKey(describeTrialNotice(trial(12), NOW)!));
  });

  it('is a card on Home, never a modal or a blocker, with no price and no payment text', () => {
    const notice = source('app/(app)/TrialNotice.tsx');
    assert.doesNotMatch(notice, /dialog|showModal|role="alertdialog"/i);
    assert.match(source('app/(app)/HomeView.tsx'), /<TrialNotice \/>\s*<AddLinkForm \/>/);
    for (const file of ['app/(app)/TrialNotice.tsx', 'lib/trialNotice.ts']) {
      assert.doesNotMatch(source(file), /price|currency|KRW|USD|₩/i, file);
    }
  });
});
