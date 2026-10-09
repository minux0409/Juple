import { stripLegacyReplyMention } from '../replyMention';

describe('stripLegacyReplyMention', () => {
  it('leaves a clean body (no leading mention) untouched', () => {
    expect(stripLegacyReplyMention('agreed', '지우')).toBe('agreed');
  });

  it('drops exactly one redundant leading "@target " (any whitespace after it)', () => {
    expect(stripLegacyReplyMention('@지우 agreed', '지우')).toBe('agreed');
    expect(stripLegacyReplyMention('@지우\nagreed', '지우')).toBe('agreed');
    expect(stripLegacyReplyMention('@지우 @지우 agreed', '지우')).toBe('@지우 agreed');
  });

  it('keeps a different @name, a mention in the middle, and a longer name that merely starts the same', () => {
    expect(stripLegacyReplyMention('@하늘 agreed', '지우')).toBe('@하늘 agreed');
    expect(stripLegacyReplyMention('thanks @지우 for this', '지우')).toBe('thanks @지우 for this');
    expect(stripLegacyReplyMention('@지우개 agreed', '지우')).toBe('@지우개 agreed');
  });

  it('keeps the body when nothing would remain, and when there is no reply target', () => {
    expect(stripLegacyReplyMention('@지우 ', '지우')).toBe('@지우 ');
    expect(stripLegacyReplyMention('@지우 agreed', null)).toBe('@지우 agreed');
  });
});
