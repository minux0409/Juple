import { AppRegistry } from 'react-native';
import NativeIncomingShare from './specs/NativeIncomingShare';
import { parseSharedText } from './sharedTextParser';
import { isDetailedShareDiagnosticsEnabled } from '../api/apiConfig';
import { requestAuthenticatedApi } from '../api/authenticatedApiClient';
import { ApiError } from '../api/ApiError';
import { EntraAuthError, isEntraSessionInvalidError } from '../auth/entraAuthClient';
import { AuthSessionError } from '../auth/session/authSessionErrors';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { getHostnameFromUrl } from '../items/savedLinkPrimaryText';

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
 * Quick Save ON share (see ShareReceiverActivity/IncomingShareSaveScheduler) - deliberately does
 * not apply any title/category afterward (a since-removed composer used to stage
 * draftTitle/draftCollectionId here and apply them via two extra API calls post-save; that was an
 * added failure surface for no user-visible benefit and has been removed - see this file's git
 * history for the prior composer-aware version). A user who wants a category on the saved Item
 * still adds one afterward from ItemDetails, same as any other saved link.
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

  const parsedShare = parseSharedText(pendingShare.text);
  // Dev/Dogfood only - hostname/URL-shape/booleans only, never the raw shared text, the
  // pendingShareId value, or the draft collection id (see this round's privacy hardening); the
  // request's Authorization header/access token never appears in this file at all.
  if (isDetailedShareDiagnosticsEnabled) {
    console.log('[IncomingShareHeadlessTask] start', {
      parsedKind: parsedShare.kind,
      hostname: parsedShare.kind === 'exactUrl' ? getHostnameFromUrl(parsedShare.text) : null,
      urlShape: parsedShare.kind === 'exactUrl' ? classifyUrlShape(parsedShare.text) : null,
    });
  }
  if (parsedShare.kind !== 'exactUrl') {
    await reportOutcome(pendingShareId, 'reviewRequired');
    return;
  }

  try {
    await saveInboxEntry(requestAuthenticatedApi, parsedShare.text, pendingShare.id);
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

  console.log('[IncomingShareHeadlessTask] success');
  await NativeIncomingShare.acknowledgePendingShare(pendingShare.id);
}

export function registerIncomingShareHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => incomingShareHeadlessTask);
}
