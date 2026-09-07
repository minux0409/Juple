import { requestAuthenticatedApi } from '../api/authenticatedApiClient';
import { getOrCreatePushInstallationId } from './pushInstallationId';
import { unregisterPushDevice } from './api/pushDevicesApi';

/**
 * Called from AuthContext.signOut, before the session/access token is cleared - the Backend needs
 * a still-valid access token to identify which user's registration to disable (see
 * PushDeviceRegistration.Disable). Best-effort: a failed unregister (offline, Backend down, ...)
 * must never block logout - the Backend also disables stale/unreachable registrations over time
 * independently of this call.
 */
export async function unregisterCurrentPushDeviceBestEffort(): Promise<void> {
  try {
    const installationId = await getOrCreatePushInstallationId();
    await unregisterPushDevice(requestAuthenticatedApi, installationId);
  } catch {
    // Best-effort - see this function's own doc comment.
  }
}
