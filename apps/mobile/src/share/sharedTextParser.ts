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

  try {
    const url = new URL(trimmedText);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'exactUrl', text: trimmedText };
    }
  } catch {
    // Only the complete payload is accepted as an exact URL - fall through below for text that
    // carries a URL alongside other content (a description prefix, trailing hashtags, ...).
  }

  // The share text isn't itself a bare URL (handled above), but may still contain exactly one
  // usable URL somewhere inside it - e.g. a "설명 + URL" share. The URL field this feeds (Home's
  // input, NewLinkReview's prefilled url) must show that clean URL alone, never the raw prefixed
  // text (see this round's real-device report: a description like "당근에서 이 글을 확인해보세요!"
  // was left sitting in front of the URL). kind stays 'reviewText' regardless - a description
  // alongside the URL is still worth a human glance before Quick Save ON would ever silently save
  // it; this only cleans the URL text itself, it never reclassifies headless-eligibility (see
  // incomingShareHeadlessTask.ts, which only proceeds for kind === 'exactUrl').
  const extractedUrl = extractFirstHttpUrl(text);
  if (extractedUrl) {
    return { kind: 'reviewText', text: extractedUrl };
  }

  return { kind: 'reviewText', text };
}

const SINGLE_URL_PATTERN = /https?:\/\/\S+/i;
const URL_PATTERN = /https?:\/\/\S+/gi;

export interface SharedTextTitleCandidate {
  readonly url: string;
  readonly titleCandidate: string;
}

/**
 * Only meaningful when parseSharedText's result is 'reviewText' (an exact URL has no surrounding
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
