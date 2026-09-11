import { extractTitleCandidateFromSharedText, parseSharedText } from './sharedTextParser';
import type { PendingShare } from './specs/NativeIncomingShare';

/**
 * Where the resolved title came from - diagnostics-safe (an enum, never the title text itself):
 * - 'draft': a composer draft persisted with the pending share (reserved wire field - always null today).
 * - 'intent': the sharing app's own EXTRA_SUBJECT/EXTRA_TITLE, captured natively at share time
 *   (see ShareIntentTitleExtractor.kt) - e.g. YouTube puts the video title in EXTRA_SUBJECT.
 * - 'sharedText': leading text before a single URL inside the shared text itself
 *   (see extractTitleCandidateFromSharedText).
 * - 'none': the sharing app provided no usable title - the Item's title stays blank
 *   (SavedLinkRow's hostname fallback covers display; nothing is ever guessed).
 */
export type IncomingShareTitleSource = 'draft' | 'intent' | 'sharedText' | 'none';

export interface ResolvedIncomingShare {
  /** Mirrors parseSharedText: 'exactUrl' saves headlessly; 'reviewText' always needs user review. */
  readonly kind: 'exactUrl' | 'reviewText';
  /** The exact http/https URL when kind is 'exactUrl'; otherwise the raw shared text for the review screen to edit. */
  readonly text: string;
  readonly title: string | null;
  readonly titleSource: IncomingShareTitleSource;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Rejects candidates that would violate the title rules: blank, the shared text itself, or
 * anything that is itself an http/https URL (a URL is never a title - SavedLinkRow's hostname
 * fallback handles display for title-less Items instead).
 */
function sanitizeTitleCandidate(
  candidate: string | null | undefined,
  sharedText: string,
): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed || trimmed === sharedText.trim() || isHttpUrl(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * The one place Quick Save ON (incomingShareHeadlessTask) and Quick Save OFF
 * (IncomingShareRouter -> NewLinkReviewScreen) both resolve an incoming share's URL and title
 * from - previously OFF read the native initialTitle while ON ignored it entirely, which is why
 * a YouTube share got a title with Quick Save OFF but not ON.
 *
 * Title priority - only ever values the sharing app actually provided, never guessed:
 * 1. draftTitle (reserved composer wire field - always null today, kept first for queue-schema compatibility)
 * 2. initialTitle (the app's own EXTRA_SUBJECT/EXTRA_TITLE - the explicit share-time signal)
 * 3. leading text before a single URL inside the shared text (only possible for 'reviewText')
 */
export function resolveIncomingShare(
  share: Pick<PendingShare, 'text' | 'initialTitle' | 'draftTitle'>,
): ResolvedIncomingShare {
  const parsed = parseSharedText(share.text);

  const draftTitle = sanitizeTitleCandidate(share.draftTitle, share.text);
  if (draftTitle) {
    return { kind: parsed.kind, text: parsed.text, title: draftTitle, titleSource: 'draft' };
  }

  const intentTitle = sanitizeTitleCandidate(share.initialTitle, share.text);
  if (intentTitle) {
    return { kind: parsed.kind, text: parsed.text, title: intentTitle, titleSource: 'intent' };
  }

  if (parsed.kind === 'reviewText') {
    const candidate = extractTitleCandidateFromSharedText(share.text)?.titleCandidate;
    const sharedTextTitle = sanitizeTitleCandidate(candidate, share.text);
    if (sharedTextTitle) {
      return { kind: parsed.kind, text: parsed.text, title: sharedTextTitle, titleSource: 'sharedText' };
    }
  }

  return { kind: parsed.kind, text: parsed.text, title: null, titleSource: 'none' };
}
