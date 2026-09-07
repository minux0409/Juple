import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { hasRequestedPushPermission, markPushPermissionRequested } from './pushPermissionRequestState';
import { requestPushPermission } from './pushPermission';
import { syncPushRegistrationIfPermitted } from './pushRegistrationSync';

/**
 * The one and only place the OS notification-permission prompt is ever shown - called right after
 * a user's first successful RepeatPurchase creation (see RepeatPurchaseEditorScreen). The
 * RepeatPurchase save itself already succeeded before this runs and is never gated on it.
 *
 * Never re-prompts once a decision has been made (see pushPermissionRequestState.ts):
 * PermissionsAndroid.check() cannot tell "never asked" apart from "asked and denied", so a
 * persisted flag is the only way to honor that. A denial leaves the in-app Notification Center
 * fully usable - nothing here (or anywhere else) blocks on the result.
 */
export async function ensurePushPermissionAfterFirstRepeatPurchase(
  authenticatedRequest: AuthenticatedApiRequest,
): Promise<void> {
  try {
    if (await hasRequestedPushPermission()) {
      return;
    }

    await markPushPermissionRequested();
    const status = await requestPushPermission();
    if (status === 'granted') {
      await syncPushRegistrationIfPermitted(authenticatedRequest);
    }
  } catch {
    // Best-effort - RepeatPurchase creation already succeeded and must never be affected by this.
  }
}
