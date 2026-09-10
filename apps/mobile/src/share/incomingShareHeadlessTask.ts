import { AppRegistry } from 'react-native';
import NativeIncomingShare from './specs/NativeIncomingShare';
import { parseSharedText } from './sharedTextParser';
import { requestAuthenticatedApi } from '../api/authenticatedApiClient';
import { ApiError } from '../api/ApiError';
import { EntraAuthError, isEntraSessionInvalidError } from '../auth/entraAuthClient';
import { AuthSessionError } from '../auth/session/authSessionErrors';
import { addItemToCollection } from '../collections/api/collectionsApi';
import { saveInboxEntry } from '../inbox/api/inboxApi';
import { updateItemDetails } from '../items/api/itemsApi';

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
 * clientRequestId idempotency the manual/foreground share flow uses. This only ever runs after
 * the user has confirmed Save in the Quick Save composer (see
 * NativeIncomingShare.submitQuickSaveDraft) - draftTitle/draftCollectionId are what the composer
 * confirmed, never the merely-suggested initialTitle/preselectedCollectionId.
 *
 * saveInboxEntry and addItemToCollection are both already idempotent (POST /inbox replays by
 * clientRequestId; the collection PUT succeeds again for an already-a-member Item), so a retried
 * attempt after a partial failure (Item created, category link failed) safely redoes only what's
 * still needed without ever creating a second Item.
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
    return;
  }

  const parsedShare = parseSharedText(pendingShare.text);
  if (parsedShare.kind !== 'exactUrl') {
    await reportOutcome(pendingShareId, 'reviewRequired');
    return;
  }

  try {
    const savedEntry = await saveInboxEntry(
      requestAuthenticatedApi,
      parsedShare.text,
      pendingShare.id,
    );

    if (pendingShare.draftTitle) {
      await updateItemDetails(requestAuthenticatedApi, savedEntry.id, {
        title: pendingShare.draftTitle,
        memo: '',
      });
    }

    if (pendingShare.draftCollectionId !== null) {
      await addItemToCollection(
        requestAuthenticatedApi,
        pendingShare.draftCollectionId,
        savedEntry.id,
      );
    }
  } catch (error) {
    await reportOutcome(pendingShareId, classifySaveFailure(error));
    return;
  }

  await NativeIncomingShare.acknowledgePendingShare(pendingShare.id);
}

export function registerIncomingShareHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => incomingShareHeadlessTask);
}
