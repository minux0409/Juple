import { PermissionsAndroid, Platform } from 'react-native';
import { getPushPermissionStatus } from '../pushPermission';

// Spies on the real PermissionsAndroid module (RN's own Jest mock still backs the native call) and
// mutates the real Platform module's OS/Version - jest.mock('react-native', ...) is deliberately
// not used here: @react-native/jest-preset resolves the bare 'react-native' specifier through its
// own moduleNameMapper/custom resolver, which does not reliably pick up a module-factory override
// for it in this project's Jest setup.
describe('getPushPermissionStatus', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'Version', { value: 33, configurable: true });
  });

  it('resolves unavailable on iOS without calling PermissionsAndroid', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const check = jest.spyOn(PermissionsAndroid, 'check');

    const status = await getPushPermissionStatus();

    expect(status).toBe('unavailable');
    expect(check).not.toHaveBeenCalled();
  });

  it('reflects the current OS grant state without prompting', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);

    const status = await getPushPermissionStatus();

    expect(status).toBe('granted');
  });

  it('resolves denied (never throws) when the native call rejects', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.spyOn(PermissionsAndroid, 'check').mockRejectedValue(new Error('native module unavailable'));

    await expect(getPushPermissionStatus()).resolves.toBe('denied');
  });
});
