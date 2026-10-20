import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  getPushPermissionStatus,
  requestPushPermission,
} from '../pushPermission';
const os = Platform.OS;
const version = Platform.Version;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  Object.defineProperty(Platform, 'Version', {
    value: version,
    configurable: true,
  });
  delete NativeModules.JupleNotificationPermissions;
  jest.restoreAllMocks();
});
it('uses OS app-notification switch on Android before runtime permission was introduced', async () => {
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  Object.defineProperty(Platform, 'Version', { value: 32, configurable: true });
  NativeModules.JupleNotificationPermissions = {
    getStatus: jest
      .fn()
      .mockResolvedValueOnce('denied')
      .mockResolvedValueOnce('granted'),
  };
  expect(await getPushPermissionStatus()).toBe('denied');
  expect(await getPushPermissionStatus()).toBe('granted');
});
it('iOS reads native status, skips existing grants and requests only explicit consent', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  const request = jest.fn().mockResolvedValue('granted');
  NativeModules.JupleNotificationPermissions = {
    getStatus: jest
      .fn()
      .mockResolvedValueOnce('granted')
      .mockResolvedValueOnce('notDetermined'),
    request,
  };
  expect(await requestPushPermission()).toBe('granted');
  expect(request).not.toHaveBeenCalled();
  expect(await requestPushPermission()).toBe('granted');
  expect(request).toHaveBeenCalledTimes(1);
});
it('Android grant response is checked against actual OS status after the prompt', async () => {
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  Object.defineProperty(Platform, 'Version', { value: 33, configurable: true });
  NativeModules.JupleNotificationPermissions = {
    getStatus: jest.fn().mockResolvedValue('denied'),
  };
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  expect(await requestPushPermission()).toBe('denied');
});
