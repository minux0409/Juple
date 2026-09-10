export type SharedTextParseResult =
  | { readonly kind: 'exactUrl'; readonly text: string }
  | { readonly kind: 'reviewText'; readonly text: string };

export function parseSharedText(text: string): SharedTextParseResult {
  const trimmedText = text.trim();

  try {
    const url = new URL(trimmedText);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'exactUrl', text: trimmedText };
    }
  } catch {
    // Only the complete payload is accepted as an exact URL.
  }

  return { kind: 'reviewText', text };
}

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
