import i18n from '../../i18n';
import { formatSaveOutcomeMessage, needsSaveOutcomeDialog } from '../saveOutcomeMessage';

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

  it('Case A: nothing new proposed, the chosen Collection already has it waiting - the link was still saved', () => {
    const outcome = { added: 0, submitted: 0, alreadyPending: 1 };

    expect(needsSaveOutcomeDialog(outcome)).toBe(true);
    expect(formatSaveOutcomeMessage(outcome, i18n.t)).toBe('링크는 저장되었어요.\n선택한 컬렉션에는 이미 승인 대기 중인 링크가 있어요.');
  });

  it('a new proposal and an already-waiting one: one message, the proposal first', () => {
    const message = formatSaveOutcomeMessage({ added: 0, submitted: 1, alreadyPending: 1, alreadyInCollection: 1 }, i18n.t);

    expect(message.split('\n')[0]).toBe('링크는 저장되었어요.');
    expect(message).toContain('승인 요청을 보냈어요');
    expect(message).toContain('이미 승인 대기 중인 링크가 있어요');
    expect(message).toContain('이미 같은 링크가 있어요');
  });

  it('direct additions only need no dialog', () => {
    expect(needsSaveOutcomeDialog({ added: 2, submitted: 0 })).toBe(false);
    expect(needsSaveOutcomeDialog({ added: 0, submitted: 0, alreadyPending: 0, alreadyInCollection: 0 })).toBe(false);
  });

  it.each(['en', 'ko', 'ja', 'de', 'ar'])('%s has real text for both outcomes (no leftover placeholder braces)', async language => {
    await i18n.changeLanguage(language);
    for (const outcome of [{ added: 0, submitted: 1 }, { added: 2, submitted: 3 }, { added: 0, submitted: 0, alreadyPending: 1, alreadyInCollection: 1 }]) {
      const message = formatSaveOutcomeMessage(outcome, i18n.t);
      expect(message).not.toMatch(/\{\{|collections\.saveOutcome/);
    }
    await i18n.changeLanguage('ko');
  });
});
