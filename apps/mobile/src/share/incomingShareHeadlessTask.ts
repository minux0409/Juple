import { AppRegistry } from 'react-native';
import NativeIncomingShare from './specs/NativeIncomingShare';
import { resolveIncomingShare } from './resolveIncomingShare';
import { isDetailedShareDiagnosticsEnabled } from '../api/apiConfig';
import { requestAuthenticatedApi } from '../api/authenticatedApiClient';
import { ApiError } from '../api/ApiError';
import { EntraAuthError, isEntraSessionInvalidError } from '../auth/entraAuthClient';
import { AuthSessionError } from '../auth/session/authSessionErrors';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { updateItemDetails } from '../items/api/itemsApi';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';
import { enrichItemTitleFromUrlMetadata } from '../urlMetadata/enrichItemTitle';

/**
 * Coarse, non-identifying shape for diagnostics only - never the URL itself (path/query can carry
 * a video/post id or tracking params, both of which count as "content" for this round's privacy
 * hardening, not just the classification this exists to provide).
 */
type UrlShape = 'watch' | 'shorts' | 'other';

function classifyUrlShape(url: string): UrlShape {
  try {
    const { pathname, searchParams } = new URL(url);
    if (pathname.includes('/shorts/')) {
      return 'shorts';
    }
    if (pathname === '/watch' && searchParams.has('v')) {
      return 'watch';
    }
  } catch {
    // Falls through to 'other' below - an unparseable URL is still just "other" for this purpose.
  }
  return 'other';
}

/** Must match IncomingShareHeadlessService.TaskKey exactly. */
const TASK_KEY = 'JupleIncomingShareTask';

interface IncomingShareTaskData {
  readonly pendingShareId?: string;
}

/**
 * Outcome reported to the native retry Worker when a share is still pending after this task
 * runs, so it can decide whether the failure is worth a delayed retry. Success has no separate
 * outcome - it is signaled implicitly by the share's removal from the pending queue.
 */
type AttemptOutcome =
  | 'reviewRequired'
  | 'authenticationRequired'
  | 'retryableFailure'
  | 'permanentFailure';

/**
 * Classifies a failed saveInboxEntry attempt using only the current, real error types
 * (ApiError, EntraAuthError, AuthSessionError) - never raw exception details are reported
 * further than this.
 */
function classifySaveFailure(error: unknown): AttemptOutcome {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'unauthorized':
        return 'authenticationRequired';
      case 'timeout':
      case 'unavailable':
        return 'retryableFailure';
      case 'badRequest':
      case 'forbidden':
      case 'conflict':
        return 'permanentFailure';
    }
  }

  if (error instanceof EntraAuthError) {
    // A network/timeout failure while refreshing does not mean the session itself is invalid.
    return isEntraSessionInvalidError(error.cause)
      ? 'authenticationRequired'
      : 'retryableFailure';
  }

  if (error instanceof AuthSessionError) {
    return 'authenticationRequired';
  }

  // Anything else (e.g. an empty/malformed API response body) is unexpected but not known to be
  // permanent, so it gets the same bounded-retry treatment as a genuine infrastructure failure.
  return 'retryableFailure';
}

async function reportOutcome(
  pendingShareId: string,
  outcome: AttemptOutcome,
): Promise<void> {
  if (!NativeIncomingShare) {
    return;
  }
  await NativeIncomingShare.reportAttemptOutcome(pendingShareId, outcome);
}

/**
 * Looks up the pending share captured by ShareReceiverActivity and, only when its text is an
 * exact http/https URL, saves it in the background using the same authenticated client and
 * clientRequestId idempotency the manual/foreground share flow uses. Runs immediately for every
 * Quick Save ON share (see ShareReceiverActivity/IncomingShareSaveScheduler). When the sharing
 * app itself provided a title (resolveIncomingShare - the same resolver Quick Save OFF's review
 * flow prefills from), it is applied post-save via the same updateItemDetails call the review
 * screen's Save uses, so ON/OFF produce identically-titled Items; no category is ever applied
 * here (a shortcut-resolved preselectedCollectionId stays review-only), and no title is ever
 * guessed - a title-less share simply saves a title-less Item.
 *
 * saveInboxEntry is already idempotent (POST /inbox replays by clientRequestId), so a retried
 * attempt after a failure safely resolves to the same Item without ever creating a second one.
 *
 * Any failure (no session, network, timeout, non-2xx) leaves the pending share for a possible
 * retry (see IncomingShareRetryWorker) or manual review, and reports why via reportOutcome; this
 * task itself never retries and never touches React UI/auth state.
 */
async function incomingShareHeadlessTask(
  taskData: IncomingShareTaskData,
): Promise<void> {
  const pendingShareId = taskData.pendingShareId;
  if (!pendingShareId || !NativeIncomingShare) {
    return;
  }

  const pendingShares = await NativeIncomingShare.getPendingShares();
  const pendingShare = pendingShares.find(
    share => share.id === pendingShareId,
  );
  if (!pendingShare) {
    // Dev/Dogfood only, counts only - never the actual pendingShareId/queue id values (see this
    // round's privacy hardening).
    if (isDetailedShareDiagnosticsEnabled) {
      console.warn('[IncomingShareHeadlessTask] pendingShareId not found in native queue', {
        knownPendingShareCount: pendingShares.length,
      });
    }
    return;
  }

  const resolvedShare = resolveIncomingShare(pendingShare);
  // Dev/Dogfood only - hostname/URL-shape/booleans/enums only, never the raw shared text, the
  // resolved title text, the pendingShareId value, or the draft collection id (see this round's
  // privacy hardening); the request's Authorization header/access token never appears in this
  // file at all.
  if (isDetailedShareDiagnosticsEnabled) {
    console.log('[IncomingShareHeadlessTask] start', {
      parsedKind: resolvedShare.kind,
      hostname: resolvedShare.kind === 'exactUrl' ? getHostnameFromUrl(resolvedShare.text) : null,
      urlShape: resolvedShare.kind === 'exactUrl' ? classifyUrlShape(resolvedShare.text) : null,
      resolvedTitlePresent: resolvedShare.title !== null,
      titleSource: resolvedShare.titleSource,
    });
  }
  if (resolvedShare.kind !== 'exactUrl') {
    await reportOutcome(pendingShareId, 'reviewRequired');
    return;
  }

  let savedEntryId: number;
  try {
    const savedEntry = await saveInboxEntry(requestAuthenticatedApi, resolvedShare.text, pendingShare.id);
    savedEntryId = savedEntry.id;
  } catch (error) {
    const outcome = classifySaveFailure(error);
    // Always on, including Production - API kind/status and the resulting failure classification
    // are the privacy-reviewed allowlist for this log; deliberately no pendingShareId, no raw error
    // message (which could otherwise carry more than kind/status for an unexpected error type), and
    // no shared content of any kind.
    console.warn('[IncomingShareHeadlessTask] save failed', {
      outcome,
      errorKind: error instanceof ApiError ? error.kind : undefined,
      errorStatus: error instanceof ApiError ? error.status : undefined,
      errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
    });
    await reportOutcome(pendingShareId, outcome);
    return;
  }

  // Applies the share-time resolved title (same resolveIncomingShare result Quick Save OFF's
  // review screen prefills from, and the same saveInboxEntry -> updateItemDetails sequence that
  // screen's Save uses) so an ON save is no longer title-less when the sharing app provided one
  // (e.g. YouTube's EXTRA_SUBJECT). Deliberately best-effort: the Item already exists, so a failed
  // title PUT must not leave the share pending - a retry would replay the (idempotent) save and
  // then blindly re-PUT title+memo, which could overwrite edits the user made in the meantime.
  // Worst case of this ordering is the pre-existing behavior: a saved Item with no title.
  if (resolvedShare.title !== null) {
    try {
      await updateItemDetails(requestAuthenticatedApi, savedEntryId, {
        title: resolvedShare.title,
        memo: '',
      });
    } catch (error) {
      // Always-on, privacy-safe (kind/status only - never the title text or URL).
      console.warn('[IncomingShareHeadlessTask] title apply failed', {
        errorKind: error instanceof ApiError ? error.kind : undefined,
        errorStatus: error instanceof ApiError ? error.status : undefined,
        errorConstructor: error instanceof Error ? error.constructor.name : typeof error,
      });
    }
  } else {
    // No title from Intent/sharedText - best-effort URL-metadata fallback (same policy
    // NewLinkReviewScreen/DailyInboxScreen use - see enrichItemTitleFromUrlMetadata). Its own
    // try/catch already never throws, so a failure here never leaves the share pending or unsaved.
    await enrichItemTitleFromUrlMetadata(requestAuthenticatedApi, savedEntryId, resolvedShare.text);
  }

  console.log('[IncomingShareHeadlessTask] success');
  await NativeIncomingShare.acknowledgePendingShare(pendingShare.id);
}

export function registerIncomingShareHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => incomingShareHeadlessTask);
}
