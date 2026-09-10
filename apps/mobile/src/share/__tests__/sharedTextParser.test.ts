import { extractTitleCandidateFromSharedText, parseSharedText } from '../sharedTextParser';

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

  it('classifies a URL with surrounding text as reviewText', () => {
    expect(parseSharedText('Check this out: https://example.com/a')).toEqual({
      kind: 'reviewText',
      text: 'Check this out: https://example.com/a',
    });
  });

  it('classifies unparseable text as reviewText', () => {
    expect(parseSharedText('not a url at all')).toEqual({
      kind: 'reviewText',
      text: 'not a url at all',
    });
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
