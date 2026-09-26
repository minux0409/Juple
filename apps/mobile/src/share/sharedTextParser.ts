export type SharedTextParseResult =
  | { readonly kind: 'exactUrl'; readonly text: string }
  | { readonly kind: 'reviewText'; readonly text: string };

/**
 * Extracts the first http(s) URL token found anywhere in arbitrary pasted/shared text - e.g.
 * "당근에서 이 글을 확인해보세요!\n\nhttps://www.daangn.com/articles/1253314119?share=true" yields
 * exactly "https://www.daangn.com/articles/1253314119?share=true", with the leading description
 * discarded entirely (never partially kept). `\S+` already stops the match at the first whitespace/
 * newline after "http(s)://", which is exactly the rule this needs: any trailing caption/hashtag
 * text is cut off, while query-string characters (?, &, =, %) are always preserved since `\S+`
 * only ever breaks on whitespace. Deliberately does not strip trailing punctuation (a bare "."
 * or ")" immediately after a URL, with no whitespace before it, stays part of the match) - no real
 * need for that aggressiveness has been confirmed, and stripping it could just as easily corrupt a
 * URL that legitimately ends in that character. Returns null when no http(s) URL is present at
 * all, so callers fall back to their own existing "no URL" handling rather than guessing one.
 */
export function extractFirstHttpUrl(text: string): string | null {
  return text.match(SINGLE_URL_PATTERN)?.[0] ?? null;
}

export function parseSharedText(text: string): SharedTextParseResult {
  const trimmedText = text.trim();

  // Only a whitespace-free payload is taken whole: the URL parser tolerates inner spaces, so a
  // "URL #caption" payload would otherwise parse as one URL with the caption folded into it.
  if (!/\s/.test(trimmedText)) {
    try {
      const url = new URL(trimmedText);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { kind: 'exactUrl', text: trimmedText };
      }
    } catch {
      // Not a URL on its own - fall through below for text that carries a URL alongside other
      // content (a description prefix, trailing hashtags, ...).
    }
  }

  // The share text isn't itself a bare URL (handled above), but may still carry its URL alongside
  // other content - a "설명 + URL" share (e.g. "당근에서 이 글을 확인해보세요!\n\nhttps://..."),
  // a share title/subject line, a trailing caption. Exactly one valid http/https URL is the same
  // unambiguous save target as a bare URL, so it is 'exactUrl' too: Quick Save ON must not depend on
  // how the sharing app happened to format its payload (see incomingShareHeadlessTask.ts, which only
  // proceeds for kind === 'exactUrl'). The surrounding text is never part of the URL; it only ever
  // feeds the separate title candidate (see extractTitleCandidateFromSharedText).
  const urls = text.match(URL_PATTERN) ?? [];
  if (urls.length === 1 && isHttpUrlToken(urls[0]) && hasCertainBoundaryInText(urls[0])) {
    return { kind: 'exactUrl', text: urls[0] };
  }

  // No URL, more than one (ambiguous - which one did the user mean?), or one whose end inside the
  // text is uncertain - stays 'reviewText' so the user confirms on the review screen rather than a
  // guess being saved silently. The URL field this
  // feeds (Home's input, NewLinkReview's prefilled url) still gets the first URL alone, never the
  // raw prefixed text.
  const extractedUrl = extractFirstHttpUrl(text);
  if (extractedUrl) {
    return { kind: 'reviewText', text: extractedUrl };
  }

  return { kind: 'reviewText', text };
}

/**
 * Whether a URL token cut out of surrounding text (by whitespace only - see URL_PATTERN) certainly
 * ends where the URL ends. Syntax alone cannot tell "https://a.com/x에서" (a word glued onto the
 * URL) from a real raw non-ASCII path, nor a sentence's closing "." / ")" from a path that really
 * ends in one - so neither is guessed or trimmed: any non-ASCII character, or a trailing sentence
 * punctuation/closing bracket/quote, means uncertain. Only used for mixed text; a payload that is
 * nothing but the URL has no boundary question. Percent-encoded URLs are plain ASCII and pass.
 */
function hasCertainBoundaryInText(token: string): boolean {
  return !NON_ASCII_PATTERN.test(token) && !AMBIGUOUS_TRAILING_CHARACTER_PATTERN.test(token);
}

const NON_ASCII_PATTERN = /[^\x21-\x7e]/;
const AMBIGUOUS_TRAILING_CHARACTER_PATTERN = /[.,;:!?)\]}'">]$/;

function isHttpUrlToken(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SINGLE_URL_PATTERN = /https?:\/\/\S+/i;
const URL_PATTERN = /https?:\/\/\S+/gi;

export interface SharedTextTitleCandidate {
  readonly url: string;
  readonly titleCandidate: string;
}

/**
 * Only meaningful when the shared text is not itself a bare URL (a bare URL has no surrounding
 * text to draw a title from) - looks for exactly one http/https URL inside the shared text and,
 * only when there is non-empty text before it, treats that leading text as a title candidate
 * (e.g. Instagram's "Check this out: https://..."). Trailing text after the URL is never used as
 * a title. Yields null whenever the pattern is ambiguous - no URL, more than one URL, or nothing
 * but whitespace before it - rather than guessing.
 */
export function extractTitleCandidateFromSharedText(text: string): SharedTextTitleCandidate | null {
  const matches = text.match(URL_PATTERN);
  if (!matches || matches.length !== 1) {
    return null;
  }

  const url = matches[0];
  const leadingText = text.slice(0, text.indexOf(url)).trim();
  if (!leadingText) {
    return null;
  }

  return { url, titleCandidate: leadingText };
}
