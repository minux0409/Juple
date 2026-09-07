import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootStack';

/**
 * Lets code outside the React tree (a Push notification tap handler - see
 * src/push/usePushMessageHandling.ts) navigate imperatively, since it has no `navigation` prop of
 * its own. `navigationRef.isReady()` only means NavigationContainer has mounted - it says nothing
 * about which screens RootStack currently renders (that also depends on auth/bootstrap state), so
 * callers must not treat it as "safe to navigate anywhere" on its own; see pendingPushTarget.ts.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
