import { Share } from 'react-native';
import { formatLinkList } from '../formatLinkList';
import { shareLinks } from '../shareItem';

describe('formatLinkList - several links copied or shared together', () => {
  it('puts exactly one blank line between links and nothing before the first or after the last', () => {
    expect(formatLinkList(['https://example.com/first', 'https://example.com/second', 'https://example.com/third']))
      .toBe('https://example.com/first\n\nhttps://example.com/second\n\nhttps://example.com/third');
  });

  it('two links', () => {
    expect(formatLinkList(['https://a.test', 'https://b.test'])).toBe('https://a.test\n\nhttps://b.test');
  });

  it('a single link has no surrounding newline', () => {
    expect(formatLinkList(['https://a.test'])).toBe('https://a.test');
  });

  it('keeps the given order and does not drop repeated addresses', () => {
    expect(formatLinkList(['https://b.test', 'https://a.test', 'https://b.test'])).toBe('https://b.test\n\nhttps://a.test\n\nhttps://b.test');
  });

  it('never starts or ends with a line break', () => {
    const text = formatLinkList(['https://a.test', 'https://b.test', 'https://c.test']);
    expect(text.startsWith('\n')).toBe(false);
    expect(text.endsWith('\n')).toBe(false);
    expect(text).not.toContain('\n\n\n');
  });
});

describe('shareLinks uses the same format', () => {
  it('several links go to the share sheet as one text in that format', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await shareLinks(['https://a.test', 'https://b.test', 'https://c.test']);
    expect(share).toHaveBeenCalledWith({ message: 'https://a.test\n\nhttps://b.test\n\nhttps://c.test' });
    share.mockRestore();
  });
});
