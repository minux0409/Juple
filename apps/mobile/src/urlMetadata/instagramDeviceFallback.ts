import { isDetailedShareDiagnosticsEnabled } from '../api/apiConfig';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { submitInstagramMetadataCandidate, type InstagramMetadataCandidateResult } from '../items/api/itemsApi';
import { previewInstagramMetadataCandidate, type InstagramCandidatePreview } from './api/urlMetadataApi';
import {
  fetchInstagramOpenGraphCandidate,
  isInstagramContentUrl,
  type InstagramOpenGraphFetchResult,
} from './instagramOpenGraphFetch';

/**
 * The one shared Instagram device-fallback flow for every save path (Quick Save ON's headless task,
 * and NewLinkReview - which Quick Save OFF and Home's direct input both go through):
 *
 * 1. The Backend's own metadata resolve always runs first (unchanged).
 * 2. Only for an Instagram post/reel URL whose Backend result lacks a real title or a usable image
 *    (needsInstagramDeviceFallback) is the public page fetched on this device - at most once per
 *    save (callers pass an already-started fetch in to reuse it).
 * 3. Its raw OpenGraph candidate goes to the Backend, which alone validates/normalizes it and
 *    applies it as automatic metadata (never over a user's own title).
 *
 * Every failure (timeout, network, login redirect, no metadata, Backend rejection) is silent: the
 * save already succeeded, the display fallback label ("Instagram 게시물/릴스") stays, and the
 * Backend's scheduled metadata retry still runs as before.
 */

export interface KnownMetadata {
  /** A real title from the Backend's metadata or the sharing app - never the display-only "Instagram 게시물/릴스" label. */
  readonly hasTitle: boolean;
  readonly hasImage: boolean;
}

export function needsInstagramDeviceFallback(url: string, known: KnownMetadata): boolean {
  return isInstagramContentUrl(url) && !(known.hasTitle && known.hasImage);
}

export type InstagramDeviceFallbackOutcome =
  | 'applied'
  | 'nothingApplied'
  | 'noCandidate'
  | 'rejected'
  | 'failed'
  | 'previewed'
  | 'nothingPreviewed';

function logOutcome(outcome: InstagramDeviceFallbackOutcome, fetchOutcome: InstagramOpenGraphFetchResult['outcome'] | null): void {
  // Dev/Dogfood only - fixed categories, never the URL or any metadata value.
  if (isDetailedShareDiagnosticsEnabled) {
    console.log('[InstagramDeviceFallback]', { outcome, fetchOutcome });
  }
}

/**
 * Pre-save display of the device fallback (NewLinkReview): the same already-started fetch Save will
 * later reuse, normalized by the Backend's preview endpoint (the Item-scoped candidate rules, nothing
 * persisted) - never the raw OpenGraph values. Never throws; null when there is nothing usable to show.
 */
export async function previewInstagramDeviceFallback(
  request: AuthenticatedApiRequest,
  url: string,
  pendingFetch: Promise<InstagramOpenGraphFetchResult>,
): Promise<InstagramCandidatePreview | null> {
  let fetchResult: InstagramOpenGraphFetchResult | null = null;
  try {
    fetchResult = await pendingFetch;
    if (!fetchResult.candidate) {
      logOutcome('noCandidate', fetchResult.outcome);
      return null;
    }

    const preview = await previewInstagramMetadataCandidate(request, url, fetchResult.candidate);
    const usable = Boolean(preview.title || preview.previewImageUrl);
    logOutcome(usable ? 'previewed' : 'nothingPreviewed', fetchResult.outcome);
    return usable ? preview : null;
  } catch (error) {
    logOutcome(error instanceof ApiError && error.kind === 'badRequest' ? 'rejected' : 'failed', fetchResult?.outcome ?? null);
    return null;
  }
}

/**
 * Applies the device fallback to an already-saved Item. `pendingFetch` lets a caller that started
 * the device fetch earlier (NewLinkReview, while the user was still reviewing) reuse it instead of
 * fetching again. Never throws; returns the Item's resulting automatic title/image when the Backend
 * accepted the candidate, otherwise null.
 */
export async function applyInstagramDeviceFallback(
  request: AuthenticatedApiRequest,
  itemId: number,
  url: string,
  pendingFetch?: Promise<InstagramOpenGraphFetchResult>,
): Promise<InstagramMetadataCandidateResult | null> {
  let fetchResult: InstagramOpenGraphFetchResult | null = null;
  try {
    fetchResult = await (pendingFetch ?? fetchInstagramOpenGraphCandidate(url));
    if (!fetchResult.candidate) {
      logOutcome('noCandidate', fetchResult.outcome);
      return null;
    }

    const result = await submitInstagramMetadataCandidate(request, itemId, fetchResult.candidate);
    logOutcome(result.applied ? 'applied' : 'nothingApplied', fetchResult.outcome);
    return result;
  } catch (error) {
    logOutcome(error instanceof ApiError && error.kind === 'badRequest' ? 'rejected' : 'failed', fetchResult?.outcome ?? null);
    return null;
  }
}
