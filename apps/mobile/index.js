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
// React tree. Friend request / Collection invitation Push carry a `notification` block, which Android
// shows in the tray natively while the app is in the background or killed - no JS needed here. The
// data-only refresh signals are only useful to an open app (see usePushMessageHandling), so they are
// deliberately ignored in the background.
setBackgroundMessageHandler(getMessaging(), async () => {});
