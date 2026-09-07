/**
 * @format
 */

// Must be the very first import: polyfills crypto.getRandomValues before anything else (e.g.
// uuid, via pushInstallationId.ts) can call it - Hermes does not provide it natively.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { registerIncomingShareHeadlessTask } from './src/share/incomingShareHeadlessTask';

AppRegistry.registerComponent(appName, () => App);
registerIncomingShareHeadlessTask();

// React Native Firebase's own setup docs treat this as required boilerplate registered outside the
// React tree. No actual handling is needed here: every Push message this app sends always includes
// a `notification` block (see PushNotificationPayload/DispatchDuePushNotificationsService on the
// Backend), so Android's system tray display in the background/killed states happens natively
// without any JS code running - see src/push/usePushMessageHandling.ts for the tap/foreground paths
// this handler deliberately leaves alone.
setBackgroundMessageHandler(getMessaging(), async () => {});
