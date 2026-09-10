import { getHostnameFromUrl, resolveSavedLinkPrimaryText } from '../savedLinkPrimaryText';

describe('getHostnameFromUrl', () => {
  it('extracts the hostname from a valid URL', () => {
    expect(getHostnameFromUrl('https://youtube.com/watch?v=abc123')).toBe('youtube.com');
  });

  it('strips a leading www.', () => {
    expect(getHostnameFromUrl('https://www.instagram.com/p/xyz')).toBe('instagram.com');
  });

  it('works for http URLs too', () => {
    expect(getHostnameFromUrl('http://namu.wiki/w/Some+Page')).toBe('namu.wiki');
  });

  it('returns null when the URL fails to parse', () => {
    expect(getHostnameFromUrl('not a url at all')).toBeNull();
  });
});

describe('resolveSavedLinkPrimaryText', () => {
  it('uses the title when one exists, ignoring the URL entirely', () => {
    expect(resolveSavedLinkPrimaryText('My saved article', 'https://example.com/a')).toBe(
      'My saved article',
    );
  });

  it('falls back to the domain when there is no title', () => {
    expect(resolveSavedLinkPrimaryText(null, 'https://www.youtube.com/watch?v=abc')).toBe(
      'youtube.com',
    );
  });

  it('falls back to the raw URL only when both title and hostname parsing are unavailable', () => {
    expect(resolveSavedLinkPrimaryText(null, 'not-a-real-url')).toBe('not-a-real-url');
  });
});
