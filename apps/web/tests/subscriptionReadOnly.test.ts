import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { isFreePeriodEnded, subscriptionRefusalOf, type Entitlement, type StoreSubscription } from '../lib/subscription.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ended: Entitlement = {
  programEnabled: true, status: 'expired', reason: 'none', trialEndsAtUtc: '2026-10-31T00:00:00Z', accessFrozenAtUtc: '2026-10-31T00:00:00.000Z', canWrite: false,
};
const noStore: StoreSubscription = { state: 'none', platform: null, currentPeriodEndsAtUtc: null, autoRenewing: null, startedAtUtc: null, endedState: null, endedAtUtc: null };

describe('read-only after the free month: a refused change on the Web', () => {
  it('recognises only the two subscription refusals', () => {
    assert.equal(subscriptionRefusalOf(new ApiHttpError(403, 'subscriptionRequired')), 'actor');
    assert.equal(subscriptionRefusalOf(new ApiHttpError(403, 'collectionOwnerSubscriptionRequired')), 'owner');
    assert.equal(subscriptionRefusalOf(new ApiHttpError(403, 'accountRestricted')), null);
    assert.equal(subscriptionRefusalOf(new ApiHttpError(409, 'subscriptionRequired')), null);
    assert.equal(subscriptionRefusalOf(new Error('x')), null);
  });

  it('"your free period has ended" only when the free month is what ended', () => {
    assert.equal(isFreePeriodEnded(ended, noStore), true);
    assert.equal(isFreePeriodEnded(ended, null), true);
    assert.equal(isFreePeriodEnded({ ...ended, accessFrozenAtUtc: '2026-12-31T00:00:00Z' }, { ...noStore, endedState: 'expired' }), false);
    assert.equal(isFreePeriodEnded({ ...ended, status: 'trial' }, noStore), false);
    assert.equal(isFreePeriodEnded({ ...ended, programEnabled: false }, noStore), false);
  });

  it('every page goes through one place: the refusal opens ONE dialog - 멤버십 보기 (the status page, nothing is sold) and 닫기', () => {
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /const refusal = subscriptionRefusalOf\(error\);\s*if \(refusal\) \{\s*setSubscriptionRefusal\(previous => previous \?\? refusal\);/);
    assert.match(root, /router\.push\('\/me\/subscription'\)/);
    assert.match(root, /cancelLabel=\{dictionary\.close\}/);
    assert.doesNotMatch(root, /checkout|stripe/i);
  });

  it('the words are the apps\' own, in every language', () => {
    const ko = getAppDictionary('ko');
    assert.equal(ko.subscriptionRequiredTitle, '멤버십이 필요한 기능이에요');
    assert.equal(ko.subscriptionRequiredView, '멤버십 보기');
    assert.match(ko.subscriptionRequiredMessage, /^무료 이용 기간이 종료되었어요\./);
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['subscriptionRequiredTitle', 'subscriptionRequiredMessage', 'subscriptionRequiredMessageEnded', 'subscriptionRequiredView', 'subscriptionOwnerRequiredTitle', 'subscriptionOwnerRequiredMessage'] as const) {
        assert.ok(dictionary[key].trim().length > 0, `${language} ${key}`);
      }
      if (language !== 'ko') {
        assert.doesNotMatch(dictionary.subscriptionRequiredTitle, /[가-힣]/, language);
      }
    }
  });
});
