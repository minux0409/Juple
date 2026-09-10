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
import { QuickSaveComposerRoot } from './src/share/quickSaveComposer/QuickSaveComposerRoot';

AppRegistry.registerComponent(appName, () => App);
// Hosted by QuickSaveComposerActivity (Android only), a small dialog-styled Activity separate
// from MainActivity - see ShareReceiverActivity.kt.
AppRegistry.registerComponent('QuickSaveComposer', () => QuickSaveComposerRoot);
registerIncomingShareHeadlessTask();

// React Native Firebase's own setup docs treat this as required boilerplate registered outside the
// React tree, so it stays even though no active feature currently sends a Push message with a
// `notification` block - Android's system tray display in the background/killed states happens
// natively without any JS code running whenever one does arrive.
setBackgroundMessageHandler(getMessaging(), async () => {});
