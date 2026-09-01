import { AppRegistry } from 'react-native';
import NativeIncomingShare from './specs/NativeIncomingShare';
import { parseSharedText } from './sharedTextParser';
import { requestAuthenticatedApi } from '../api/authenticatedApiClient';
import { saveInboxEntry } from '../inbox/api/inboxApi';

/** Must match IncomingShareHeadlessService.TaskKey exactly. */
const TASK_KEY = 'JupleIncomingShareTask';

interface IncomingShareTaskData {
  readonly pendingShareId?: string;
}

/**
 * Looks up the pending share captured by ShareReceiverActivity and, only when its text is an
 * exact http/https URL, saves it in the background using the same authenticated client and
 * clientRequestId idempotency the manual/foreground share flow uses. Any failure (no session,
 * network, timeout, non-2xx) simply leaves the pending share for the user to review later; this
 * task never retries and never touches React UI/auth state.
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
    return;
  }

  try {
    await saveInboxEntry(
      requestAuthenticatedApi,
      parsedShare.text,
      pendingShare.id,
    );
  } catch {
    return;
  }

  await NativeIncomingShare.acknowledgePendingShare(pendingShare.id);
}

export function registerIncomingShareHeadlessTask(): void {
  AppRegistry.registerHeadlessTask(TASK_KEY, () => incomingShareHeadlessTask);
}
