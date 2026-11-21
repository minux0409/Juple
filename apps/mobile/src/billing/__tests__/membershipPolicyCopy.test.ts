import ko from '../../i18n/locales/ko.json';
import en from '../../i18n/locales/en.json';

describe('membership launch copy', () => {
  it.each([
    ['ko', ko, ['기존 회원', '신규 회원', '720시간', '주요 쓰기 기능', '구매 복원']],
    ['en', en, ['existing members', 'new members', '720 hours', 'write actions', 'restore purchases']],
  ] as const)('%s distinguishes cohorts and explains access after expiry', (_language, strings, phrases) => {
    const notice = Object.values(strings.subscription.trialNotice).join(' ');
    for (const phrase of phrases) {
      expect(notice).toContain(phrase);
    }
    expect(strings.subscription.trialNotice.welcomeBody).toContain('{{date}}');
    expect(strings.subscription.trialNotice.endingBody).toContain('{{date}}');
  });

  it('does not imply automatic conversion of the Juple trial into a store purchase', () => {
    expect(ko.subscription.billing.freeNotice).toContain('자동으로 유료 전환되지 않습니다');
    expect(en.subscription.billing.freeNotice).toContain('does not automatically become a paid subscription');
    expect(ko.subscription.billing.freeNotice).toContain('바로 결제');
    expect(en.subscription.billing.freeNotice).toContain('charges you immediately');
  });

  it('does not present an unapproved effective date or perpetual free access as agreed terms', () => {
    expect(ko.agreement.terms.subscriptionBody).toContain('시행일은 아직 확정되지 않았으며');
    expect(en.agreement.terms.subscriptionBody).toContain('effective date have not been set');
    expect(ko.agreement.terms.subscriptionBody).not.toContain('30일 이용 제한은 적용되지 않습니다');
    expect(en.agreement.terms.subscriptionBody).not.toContain('no 30-day usage limit');
  });
});
