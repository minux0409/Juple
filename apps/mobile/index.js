/**
 * @format
 */

// Must be the very first import: polyfills crypto.getRandomValues before anything else (e.g.
// uuid, via pushInstallationId.ts) can call it - Hermes does not provide it natively.
import 'react-native-get-random-values';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerIncomingShareHeadlessTask } from './src/share/incomingShareHeadlessTask';

AppRegistry.registerComponent(appName, () => App);
registerIncomingShareHeadlessTask();
