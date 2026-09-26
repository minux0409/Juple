import { extractFirstHttpUrl, extractTitleCandidateFromSharedText, parseSharedText } from '../sharedTextParser';

describe('parseSharedText', () => {
  it('classifies an exact http/https URL as exactUrl', () => {
    expect(parseSharedText('https://example.com/a')).toEqual({
      kind: 'exactUrl',
      text: 'https://example.com/a',
    });
    expect(parseSharedText('  http://example.com/a  ')).toEqual({
      kind: 'exactUrl',
      text: 'http://example.com/a',
    });
  });

  it('classifies text with a non-http(s) scheme as reviewText', () => {
    expect(parseSharedText('ftp://example.com/a')).toEqual({
      kind: 'reviewText',
      text: 'ftp://example.com/a',
    });
  });

  // Quick Save ON routing contract: exactly one http/https URL is the same unambiguous save target
  // whatever surrounds it - the payload's formatting (a description, a share title line, blank
  // lines, a trailing caption) never decides headless-eligibility, and the URL is always clean.
  it('classifies a URL with surrounding text as exactUrl, with the text cleaned to the URL alone', () => {
    expect(parseSharedText('Check this out: https://example.com/a')).toEqual({
      kind: 'exactUrl',
      text: 'https://example.com/a',
    });
  });

  it('classifies a real 당근 share (description, blank lines, then the URL) as exactUrl', () => {
    expect(
      parseSharedText('당근에서 이 글을 확인해보세요!\r\n\r\nhttps://www.daangn.com/articles/1253314119?share=true'),
    ).toEqual({
      kind: 'exactUrl',
      text: 'https://www.daangn.com/articles/1253314119?share=true',
    });
  });

  it.each([
    ['description + URL', '봐봐 https://example.com/a?x=1&y=2', 'https://example.com/a?x=1&y=2'],
    ['multi-line description + URL', '첫 줄\n둘째 줄\n\nhttps://example.com/a', 'https://example.com/a'],
    ['share title line + URL', 'Some Video Title\nhttps://www.youtube.com/watch?v=abc', 'https://www.youtube.com/watch?v=abc'],
    ['URL + trailing caption', 'https://www.instagram.com/p/ABC/ #cool', 'https://www.instagram.com/p/ABC/'],
    ['surrounding blank lines only', '\n\n  https://example.com/a  \n', 'https://example.com/a'],
  ])('%s with exactly one URL is exactUrl', (_label, text, url) => {
    expect(parseSharedText(text)).toEqual({ kind: 'exactUrl', text: url });
  });

  describe('URL boundary inside mixed text - uncertain means reviewText, never a guessed trim', () => {
    it.each([
      ['text + newline + URL', '문구\nhttps://a.com/x', 'https://a.com/x'],
      ['text + space + URL', '문구 https://a.com/x', 'https://a.com/x'],
      ['text + newline + URL with query', '문구\nhttps://a.com/x?foo=1&bar=2', 'https://a.com/x?foo=1&bar=2'],
      ['URL + space + caption', 'https://a.com/x #caption', 'https://a.com/x'],
      ['URL followed by ordinary whitespace/newlines', '문구 https://a.com/x \n\n', 'https://a.com/x'],
      ['percent-encoded non-ASCII path', '문구 https://a.com/%ED%95%9C%EA%B8%80', 'https://a.com/%ED%95%9C%EA%B8%80'],
    ])('%s stays exactUrl', (_label, text, url) => {
      expect(parseSharedText(text)).toEqual({ kind: 'exactUrl', text: url });
    });

    it.each([
      ['a word glued onto the URL', '문구 https://a.com/x에서 확인'],
      ['a raw non-ASCII path (syntactically indistinguishable from a glued word)', '문구 https://a.com/w/한국'],
      ['a trailing sentence period', '여기 봐: https://a.com/x.'],
      ['a closing parenthesis', '(링크 https://a.com/x)'],
    ])('%s is reviewText - left to the user, never auto-saved', (_label, text) => {
      expect(parseSharedText(text).kind).toBe('reviewText');
    });

    it('a bare non-ASCII URL payload stays exactUrl - no surrounding text means no boundary question', () => {
      expect(parseSharedText('https://a.com/w/한국')).toEqual({ kind: 'exactUrl', text: 'https://a.com/w/한국' });
    });

    it('a bare URL stays exactUrl, and zero URLs stay reviewText', () => {
      expect(parseSharedText('https://a.com/x')).toEqual({ kind: 'exactUrl', text: 'https://a.com/x' });
      expect(parseSharedText('문구만 있음').kind).toBe('reviewText');
    });
  });

  it('keeps a payload with more than one URL as reviewText (ambiguous), prefilled with the first URL', () => {
    expect(parseSharedText('A https://example.com/a B https://example.com/b')).toEqual({
      kind: 'reviewText',
      text: 'https://example.com/a',
    });
  });

  it('keeps text whose only URL-like token is not a valid URL as reviewText', () => {
    expect(parseSharedText('broken http://[not-a-host link')).toEqual({
      kind: 'reviewText',
      text: 'http://[not-a-host',
    });
  });

  it('classifies unparseable text as reviewText', () => {
    expect(parseSharedText('not a url at all')).toEqual({
      kind: 'reviewText',
      text: 'not a url at all',
    });
  });
});

describe('extractFirstHttpUrl', () => {
  it('extracts the URL out of a real 당근 share (description, blank lines, then the URL)', () => {
    expect(
      extractFirstHttpUrl('당근에서 이 글을 확인해보세요!\r\n\r\nhttps://www.daangn.com/articles/1253314119?share=true'),
    ).toBe('https://www.daangn.com/articles/1253314119?share=true');
  });

  it('extracts the URL out of leading casual text with no punctuation before it', () => {
    expect(extractFirstHttpUrl('봐봐 http://example.com/a')).toBe('http://example.com/a');
  });

  it('leaves an already-bare URL unchanged', () => {
    expect(extractFirstHttpUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('stops at the first URL and discards trailing text after it', () => {
    expect(extractFirstHttpUrl('설명 https://example.com/a\n뒤 문구')).toBe('https://example.com/a');
  });

  it('returns null when there is no URL at all', () => {
    expect(extractFirstHttpUrl('URL 없음')).toBeNull();
  });

  it('preserves query-string characters (?, &, =, %) in full', () => {
    expect(extractFirstHttpUrl('링크: https://example.com/a?x=1&y=2%20three')).toBe(
      'https://example.com/a?x=1&y=2%20three',
    );
  });
});

describe('extractTitleCandidateFromSharedText', () => {
  it('extracts leading text before a single URL as the title candidate', () => {
    expect(extractTitleCandidateFromSharedText('Check this out: https://example.com/a')).toEqual({
      url: 'https://example.com/a',
      titleCandidate: 'Check this out:',
    });
  });

  it('returns null when the text is only a URL (no leading text)', () => {
    expect(extractTitleCandidateFromSharedText('https://example.com/a')).toBeNull();
  });

  it('returns null when there is no URL at all', () => {
    expect(extractTitleCandidateFromSharedText('just some text, no link')).toBeNull();
  });

  it('returns null when there is more than one URL (ambiguous)', () => {
    expect(
      extractTitleCandidateFromSharedText('See https://example.com/a and https://example.com/b'),
    ).toBeNull();
  });

  it('never uses trailing text after the URL as the title', () => {
    const result = extractTitleCandidateFromSharedText('https://example.com/a #cool #trending');
    expect(result).toBeNull();
  });
});
