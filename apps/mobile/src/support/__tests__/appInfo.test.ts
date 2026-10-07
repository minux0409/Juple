import { Platform } from 'react-native';
import i18n from '../../i18n';
import { getAppInfo, getSupportDiagnostics } from '../appInfo';

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getVersion: () => '2.4.1', getBuildNumber: () => '317', getSystemVersion: () => '15', getModel: () => 'Pixel 9' },
}));

describe('app info', () => {
  it('reads the real version and build from the installed app', () => {
    expect(getAppInfo()).toEqual({ version: '2.4.1', build: '317' });
  });

  it('diagnostics are exactly app version/build, platform, OS version, device model and app language', async () => {
    await i18n.changeLanguage('ko');
    expect(getSupportDiagnostics()).toEqual({
      appVersion: '2.4.1',
      buildNumber: '317',
      platform: Platform.OS,
      osVersion: '15',
      deviceModel: 'Pixel 9',
      locale: 'ko',
    });
  });

  it('carries nothing that identifies the person or what they saved', () => {
    expect(Object.keys(getSupportDiagnostics()).sort()).toEqual(['appVersion', 'buildNumber', 'deviceModel', 'locale', 'osVersion', 'platform']);
  });
});
