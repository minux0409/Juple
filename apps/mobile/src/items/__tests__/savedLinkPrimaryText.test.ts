import {
  getHostnameFromUrl,
  resolveKnownContentFallbackKey,
  resolveSavedLinkDisplayTitle,
  resolveSavedLinkPrimaryText,
} from '../savedLinkPrimaryText';

describe('resolveKnownContentFallbackKey', () => {
  it.each([
    ['https://www.instagram.com/p/ABC123xyz/', 'item.fallbackInstagramPost'],
    ['https://www.instagram.com/p/ABC123xyz/?igsh=abc', 'item.fallbackInstagramPost'],
    ['https://instagram.com/some.user/p/ABC123xyz', 'item.fallbackInstagramPost'],
    ['https://www.instagram.com/reel/ABC123xyz/?igsh=abc', 'item.fallbackInstagramReel'],
    ['https://www.instagram.com/reels/ABC123xyz/', 'item.fallbackInstagramReel'],
    ['https://m.instagram.com/some_user/reel/ABC123xyz/', 'item.fallbackInstagramReel'],
  ])('labels %s by its structural content type', (url, expected) => {
    expect(resolveKnownContentFallbackKey(url)).toBe(expected);
  });

  it.each([
    'https://www.instagram.com/some_user/',
    'https://www.instagram.com/stories/some_user/123/',
    'https://www.instagram.com/explore/',
    'https://example.com/p/ABC123xyz/',
    'https://notinstagram.com/p/ABC123xyz/',
    'not a url',
  ])('never labels %s', url => {
    expect(resolveKnownContentFallbackKey(url)).toBeNull();
  });
});

describe('resolveSavedLinkDisplayTitle', () => {
  const translate = (key: string) => `[${key}]`;

  it('always prefers a real title over any fallback label', () => {
    expect(resolveSavedLinkDisplayTitle('Real title', 'https://www.instagram.com/reel/ABC/', translate)).toEqual({
      text: 'Real title',
      isTechnicalIdentifier: false,
    });
  });

  it('uses the localized content label (not LTR-forced) for a title-less Instagram reel', () => {
    expect(resolveSavedLinkDisplayTitle(null, 'https://www.instagram.com/reel/ABC/', translate)).toEqual({
      text: '[item.fallbackInstagramReel]',
      isTechnicalIdentifier: false,
    });
  });

  it('keeps the LTR hostname fallback for anything else', () => {
    expect(resolveSavedLinkDisplayTitle(null, 'https://www.instagram.com/some_user/', translate)).toEqual({
      text: 'instagram.com',
      isTechnicalIdentifier: true,
    });
    expect(resolveSavedLinkDisplayTitle(null, 'https://example.com/a', translate)).toEqual({
      text: 'example.com',
      isTechnicalIdentifier: true,
    });
  });
});

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
