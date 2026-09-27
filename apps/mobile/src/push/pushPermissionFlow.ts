import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { hasRequestedPushPermission, markPushPermissionRequested } from './pushPermissionRequestState';
import { requestPushPermission } from './pushPermission';
import { syncPushRegistrationIfPermitted } from './pushRegistrationSync';

/**
 * The one place the OS notification prompt is shown: the first time the user opens a social screen
 * (친구, 공유) - where friend requests and Collection invitations are about - never at app start.
 * Asked at most once (PermissionsAndroid.check cannot tell "never asked" from "denied", hence the
 * persisted flag). A denial changes nothing else: badges and lists still refresh in the app.
 */
export async function ensurePushPermissionOnce(authenticatedRequest: AuthenticatedApiRequest): Promise<void> {
  try {
    if (await hasRequestedPushPermission()) {
      return;
    }
    await markPushPermissionRequested();
    if ((await requestPushPermission()) === 'granted') {
      await syncPushRegistrationIfPermitted(authenticatedRequest);
    }
  } catch {
    // Best effort - never affects the screen that asked.
  }
}
