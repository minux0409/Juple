import { SUPPORTED_LANGUAGES } from '../../i18n';

const { readFileSync } = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
const { resolve } = require('path') as { resolve: (...paths: string[]) => string };

const localeRoot = resolve(__dirname, '../../i18n/locales');
const draftRoot = resolve(__dirname, '../../../../../docs/legal/membership-drafts');
const targets = SUPPORTED_LANGUAGES.filter(language => language !== 'ko' && language !== 'en');
type Locale = { subscription: { billing: { freeNotice: string; summaryMonthly: string; summaryYearly: string; cancelHowAndroid: string; cancelHowIos: string }; trialNotice: { welcomeBody: string; endingBody: string; welcomeTitle: string } }; agreement: { terms: { subscriptionBody: string } }; deleteAccount: { warningIntro: string }; welcomeTrial: { body: string }; membership: { trialCard: { title: string } } };

describe('membership language policy and draft separation', () => {
  it.each(SUPPORTED_LANGUAGES)('%s keeps exact trial duration, date and store price placeholders', language => {
    const strings: Locale = JSON.parse(readFileSync(resolve(localeRoot, `${language}.json`), 'utf8'));
    expect(strings.subscription.billing.freeNotice).toContain('720');
    expect(strings.subscription.trialNotice.welcomeBody).toContain('720');
    expect(strings.subscription.trialNotice.welcomeBody.match(/\{\{date\}\}/g)).toHaveLength(1);
    expect(strings.subscription.trialNotice.endingBody.match(/\{\{date\}\}/g)).toHaveLength(1);
    expect(strings.subscription.billing.summaryMonthly).toContain('{{price}}');
    expect(strings.subscription.billing.summaryYearly).toContain('{{price}}');
    expect(strings.welcomeTrial.body).toContain('720');
    expect(strings.welcomeTrial.body.match(/\{\{myPage\}\}/g)).toHaveLength(1);
    expect(strings.membership.trialCard.title).toBe(strings.subscription.trialNotice.welcomeTitle);
    expect(strings.deleteAccount.warningIntro).toContain('Google Play');
    expect(strings.deleteAccount.warningIntro).toContain('Apple App Store');
    expect(strings.agreement.terms.subscriptionBody).not.toMatch(/2026-12-01|review-pending|NOT CURRENT TERMS/);
  });

  it.each(targets)('%s keeps the full amendment outside the active agreement', language => {
    const strings: Locale = JSON.parse(readFileSync(resolve(localeRoot, `${language}.json`), 'utf8'));
    const draft = readFileSync(resolve(draftRoot, `${language}.md`), 'utf8');
    expect(draft).toContain('review-pending');
    expect(draft).toContain('effective-date: unapproved');
    expect(draft).toContain('720');
    expect(draft).toContain('24');
    expect(draft).toContain('Google Play');
    expect(draft).toContain('Apple App Store');
    const notice = strings.subscription.billing.freeNotice;
    expect(draft).toContain(notice.slice(0, notice.indexOf('720') + 3));
    expect(strings.agreement.terms.subscriptionBody).not.toContain('720');
    const manifest = JSON.parse(readFileSync(resolve(draftRoot, 'review-status.json'), 'utf8'));
    expect(manifest.languages.find((entry: { language: string }) => entry.language === language))
      .toMatchObject({ languageApproved: false, legalApproved: false });
  });
});
