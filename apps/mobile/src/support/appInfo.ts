import DeviceInfo from 'react-native-device-info';
import { Platform } from 'react-native';
import i18n from '../i18n';
import type { SupportInquiryDiagnostics } from './api/supportInquiryApi';

/** The app's own version facts - read from the installed app itself (no network, nothing about the person). */
export interface AppInfo {
  readonly version: string;
  readonly build: string;
}

export function getAppInfo(): AppInfo {
  return { version: DeviceInfo.getVersion(), build: DeviceInfo.getBuildNumber() };
}

/**
 * The only context a support inquiry carries along: app version and build, platform, OS version, device model and the
 * app language. Deliberately never the Juple ID, an email, the sign-in identity, links, titles, memos, Collection or
 * friend data, notification tokens, an IP address or a location - the Backend already knows who is signed in.
 */
export function getSupportDiagnostics(): SupportInquiryDiagnostics {
  const { version, build } = getAppInfo();
  return {
    appVersion: version,
    buildNumber: build,
    platform: Platform.OS,
    osVersion: DeviceInfo.getSystemVersion(),
    deviceModel: DeviceInfo.getModel(),
    locale: i18n.language,
  };
}
