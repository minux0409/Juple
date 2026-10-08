/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// @react-native-firebase/messaging constructs a native event emitter at *import* time (see
// @react-native-firebase/app's RNFBNativeEventEmitter), which throws immediately under Jest since
// there is no native binary - this is unrelated to anything this render test actually exercises
// (App never signs in during this test, so none of these are called), so it's stubbed the same way
// src/push/__tests__/pushRegistrationSync.test.ts already stubs it for its own suite.
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  onTokenRefresh: jest.fn(() => jest.fn()),
}));

// The Subscription screen (RootStack) reaches react-native-iap, which ships untranspiled source and needs its
// native module - neither exists under Jest, and this render test never opens that screen, so it is stubbed.
jest.mock('react-native-iap', () => ({
  initConnection: jest.fn(),
  endConnection: jest.fn(),
  fetchProducts: jest.fn(),
  requestPurchase: jest.fn(),
  finishTransaction: jest.fn(),
  getAvailablePurchases: jest.fn(),
  purchaseUpdatedListener: jest.fn(),
  purchaseErrorListener: jest.fn(),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
