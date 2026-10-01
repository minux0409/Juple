import i18n from '../../i18n';
import { formatSaveOutcomeMessage } from '../saveOutcomeMessage';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

describe('formatSaveOutcomeMessage', () => {
  it('only proposals: the link was saved, and the approval request was sent', () => {
    const message = formatSaveOutcomeMessage({ added: 0, submitted: 2 }, i18n.t);

    expect(message).toContain('링크는 저장되었어요');
    expect(message).toContain('승인 요청을 보냈어요');
    expect(message).toContain('2개');
  });

  it('proposals and direct additions together: one message that says both', () => {
    const message = formatSaveOutcomeMessage({ added: 1, submitted: 2 }, i18n.t);

    expect(message).toContain('링크는 저장되었어요');
    expect(message).toContain('컬렉션 1개에는 바로 추가했고');
    expect(message).toContain('공유 컬렉션 2개에는 승인 요청을 보냈어요');
  });

  it.each(['en', 'ko', 'ja', 'de', 'ar'])('%s has real text for both outcomes (no leftover placeholder braces)', async language => {
    await i18n.changeLanguage(language);
    for (const outcome of [{ added: 0, submitted: 1 }, { added: 2, submitted: 3 }]) {
      const message = formatSaveOutcomeMessage(outcome, i18n.t);
      expect(message).not.toMatch(/\{\{|collections\.saveOutcome/);
    }
    await i18n.changeLanguage('ko');
  });
});
