import { ApiHttpError } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { formatMessage } from './appI18n.ts';

/**
 * Adding a link from Home - the mobile flow on the same API (DailyInboxScreen.openReview -> NewLinkReviewScreen.save):
 *
 *  1. Home only checks the typed text and opens the review: a bare http(s) URL is taken as it is; text that carries one (a pasted
 *     "description + URL") gives its first URL; anything else is refused with the mobile message. Nothing is saved yet.
 *  2. The review resolves the link's metadata on the server (POST /api/v1/url-metadata/resolve - SSRF-protected; title / preview
 *     image may be null, never guessed) and asks where it goes: any number of Collections, or explicitly none.
 *  3. Save is ONE request for the link and every chosen Collection (POST /api/v1/inbox with a client request id, so a retry replays
 *     instead of duplicating), then the title / memo (PUT .../details) and the preview image (best effort).
 */

const SINGLE_URL_PATTERN = /https?:\/\/\S+/i;

/** Mobile isHttpUrl. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Home's check (mobile openReview): the URL to review, or null (then the mobile "올바른 http 또는 https 주소" message). */
export function normalizeEnteredUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (isHttpUrl(trimmed)) {
    return trimmed;
  }
  const extracted = trimmed.match(SINGLE_URL_PATTERN)?.[0] ?? null;
  return extracted && isHttpUrl(extracted) ? extracted : null;
}

/** Where 링크 저장 (the review) lives. Not under /items: see openReview. */
export const REVIEW_PATH = '/save';

/**
 * The review's address. `title` / `image` are optional starting values for a link taken from someone else's shared link (링크 저장):
 * only what that Collection shows its members - the page still resolves the link itself and nothing is saved before the person confirms.
 */
export function reviewHref(url: string, initial: { readonly title?: string | null; readonly image?: string | null } = {}): string {
  const query = new URLSearchParams({ url });
  if (initial.title) {
    query.set('title', initial.title);
  }
  if (initial.image) {
    query.set('image', initial.image);
  }
  return `${REVIEW_PATH}?${query.toString()}`;
}

/**
 * Opens 링크 저장 for a link as a SOFT (client-side) navigation, so the signed-in app stays mounted and the "checking login" screen is
 * never shown again. The review lives at /save and not at /items/new on purpose: a soft navigation to /items/new is taken by the Quick
 * Detail slot (app/(app)/@modal/(.)items/[itemId] matches "new" as an item id - Next.js cannot exclude one value of a dynamic segment
 * from an intercepting route), which left the page on screen with only the address changed and forced a full page load. /items/new
 * still works as a typed / reloaded address.
 */
export function openReview(url: string, navigate: (href: string) => void, initial: { readonly title?: string | null; readonly image?: string | null } = {}): string {
  const href = reviewHref(url, initial);
  navigate(href);
  return href;
}

export interface ResolvedUrlMetadata {
  readonly title: string | null;
  readonly previewImageUrl: string | null;
}

/** POST /api/v1/inbox's answer with Collections: what happened in each chosen one. */
export interface SavedInboxEntry {
  readonly id: number;
  readonly url: string;
  readonly savedAtUtc: string;
  readonly addedCount: number;
  readonly submittedCount: number;
  readonly alreadyInCollectionCount: number;
  readonly alreadyPendingCount: number;
}

export function saveInboxEntryBody(url: string, clientRequestId: string, collectionIds: readonly number[], unlockTokens: Readonly<Record<number, string>> = {}) {
  // unlockTokens: the grant of each chosen LOCKED Collection, by id - only what this review's picker session was given (mobile
  // NewLinkReviewScreen); never a password, never a Collection-visit grant.
  return { url, clientRequestId, collectionIds, unlockTokens };
}

/** A YouTube page that answered with its generic title is no title at all (mobile isKnownYouTubePlaceholderTitle). */
export function usableMetadataTitle(url: string, title: string | null): string | null {
  const trimmed = title?.trim();
  if (!trimmed) {
    return null;
  }
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return trimmed;
  }
  const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  const normalized = trimmed.toLowerCase();
  return isYouTube && (normalized === 'youtube' || normalized === '- youtube') ? null : trimmed;
}

/** A Juple Collection share link the server refused to save as an ordinary link (one set of rules: lib/collectionShareUrl.ts). */
export { COLLECTION_SHARE_URL_NOT_SAVABLE_CODE } from './collectionShareUrl.ts';

/** Mobile NewLinkReview getSaveErrorMessage. */
export function saveErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 429) return dictionary.tooManyRequests;
    if (error.status === 400) {
      return dictionary.inboxErrorBadRequest;
    }
    if (error.status === 403) {
      return dictionary.inboxErrorForbidden;
    }
  }
  return dictionary.inboxErrorSave;
}

/** Mobile needsSaveOutcomeDialog / formatSaveOutcomeMessage: said when a chosen Collection did not simply take the link. */
export function saveOutcomeMessage(entry: Pick<SavedInboxEntry, 'addedCount' | 'submittedCount' | 'alreadyPendingCount' | 'alreadyInCollectionCount'>, dictionary: AppDictionary): string | null {
  const { addedCount: added, submittedCount: submitted, alreadyPendingCount: alreadyPending, alreadyInCollectionCount: alreadyIn } = entry;
  if (submitted === 0 && alreadyPending === 0 && alreadyIn === 0) {
    return null;
  }
  const lines = [
    submitted > 0
      ? added > 0
        ? formatMessage(dictionary.saveOutcomeMixed, { added, submitted })
        : formatMessage(dictionary.saveOutcomeSubmitted, { count: submitted })
      : dictionary.saveOutcomeSaved,
  ];
  if (alreadyPending > 0) {
    lines.push(dictionary.saveOutcomeAlreadyPending);
  }
  if (alreadyIn > 0) {
    lines.push(dictionary.saveOutcomeAlreadyInCollection);
  }
  return lines.join('\n');
}
