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

export function reviewHref(url: string): string {
  return `/items/new?${new URLSearchParams({ url }).toString()}`;
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

export function saveInboxEntryBody(url: string, clientRequestId: string, collectionIds: readonly number[]) {
  // No unlock grant: a locked Collection is not offered as a destination on the Web (it would need its password first).
  return { url, clientRequestId, collectionIds, unlockTokens: {} };
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

/** The server refused to save a Juple Collection share link as an ordinary link (mobile COLLECTION_SHARE_URL_NOT_SAVABLE_CODE). */
export const COLLECTION_SHARE_URL_NOT_SAVABLE_CODE = 'collectionShareUrlNotSavableAsLink';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** The public id of a share link the server just recognized as one (mobile publicIdFromServerVerifiedShareUrl). */
export function publicIdFromShareUrl(value: string): string | null {
  try {
    const match = /^\/c\/([^/]+)\/?$/.exec(new URL(value.trim()).pathname);
    const publicId = match ? decodeURIComponent(match[1]) : null;
    return publicId !== null && PUBLIC_ID_PATTERN.test(publicId) ? publicId : null;
  } catch {
    return null;
  }
}

/** Mobile NewLinkReview getSaveErrorMessage. */
export function saveErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError) {
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
