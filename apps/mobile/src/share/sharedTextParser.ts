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
