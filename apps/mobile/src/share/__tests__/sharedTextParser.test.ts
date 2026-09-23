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

  // Regression coverage for the real-device report: the URL field must show the clean URL alone,
  // never the raw "description + URL" text - kind still stays 'reviewText' (a description
  // alongside the URL is still worth a human glance; see extractFirstHttpUrl's own remarks).
  it('classifies a URL with surrounding text as reviewText, with the text cleaned to the URL alone', () => {
    expect(parseSharedText('Check this out: https://example.com/a')).toEqual({
      kind: 'reviewText',
      text: 'https://example.com/a',
    });
  });

  it('extracts the URL from a real 당근 share (description, blank lines, then the URL)', () => {
    expect(
      parseSharedText('당근에서 이 글을 확인해보세요!\r\n\r\nhttps://www.daangn.com/articles/1253314119?share=true'),
    ).toEqual({
      kind: 'reviewText',
      text: 'https://www.daangn.com/articles/1253314119?share=true',
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
