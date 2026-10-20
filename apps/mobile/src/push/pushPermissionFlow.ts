import { AppState } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { hasRequestedPushPermission, markPushPermissionRequested } from './pushPermissionRequestState';
import { requestPushPermission } from './pushPermission';
import { syncPushRegistration } from './pushRegistrationSync';

let tail: Promise<void> = Promise.resolve();
/** Serialize OS sheets across remounts; persist before asking so interruption never loops prompts. */
export function ensurePushPermissionOnce(
  request: AuthenticatedApiRequest,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const run = async () => {
    try {
      if (!isCurrent() || AppState.currentState !== 'active') return;
      if (await hasRequestedPushPermission()) return;
      if (!isCurrent() || AppState.currentState !== 'active') return;
      await markPushPermissionRequested();
      if (!isCurrent() || AppState.currentState !== 'active') return;
      const status = await requestPushPermission();
      if (status === 'granted' && isCurrent()) await syncPushRegistration(request, isCurrent);
    } catch {
      // Storage/system errors must never block Home or claim a permission grant.
    }
  };
  const result = tail.then(run, run);
  tail = result;
  return result;
}
