/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerIncomingShareHeadlessTask } from './src/share/incomingShareHeadlessTask';

AppRegistry.registerComponent(appName, () => App);
registerIncomingShareHeadlessTask();
