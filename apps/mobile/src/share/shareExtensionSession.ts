import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { apiConfig } from '../api/apiConfig';
import { selectedEntraAuthConfig } from '../auth/entraAuthConfig';
import { publicWebConfig } from '../config/publicWebConfig';

/**
 * iOS only: what the Juple Share extension (ios/JupleShareExtension) needs to save a shared link to the signed-in account - read by
 * its ShareSession.swift. One Keychain item in the App Group's access group (the extension cannot read the app's own items):
 *  - the current refresh token, so the extension can get a short-lived access token for that one share (it never writes back);
 *  - the public settings that go with it: the same Entra token endpoint / client / scopes and API address the app uses, the web host.
 * Written whenever the app stores a session (sign-in, token renewal) and on start (so an update keeps working without signing in
 * again); deleted with the app's own session on every sign-out, so the extension never saves to an account that left - and a
 * different account signing in replaces it. Device-only and readable after the first unlock (no backup / other device).
 */

const SERVICE = 'com.juple.app.share-extension.session';
const USERNAME = 'juple-share-extension-session';
/** The App Group the app and the extension share (JupleMobile.entitlements / JupleShareExtension.entitlements). */
export const SHARE_EXTENSION_ACCESS_GROUP = 'group.com.juple.app';

let lastMirroredRefreshToken: string | null = null;

/** What the extension reads (version 1). Exported for tests; nothing else should build it. */
export function shareExtensionSessionPayload(refreshToken: string): string {
  return JSON.stringify({
    version: 1,
    refreshToken,
    tokenEndpoint: selectedEntraAuthConfig.tokenEndpoint,
    clientId: selectedEntraAuthConfig.clientId,
    scopes: [...selectedEntraAuthConfig.scopes],
    apiBaseUrl: apiConfig.baseUrl ?? '',
    publicWebHost: publicWebConfig.host ?? null,
  });
}

/** Stores (or replaces) the extension's copy. Best effort: a failure only means the extension asks to open the app. */
export async function mirrorShareExtensionSession(refreshToken: string): Promise<void> {
  if (Platform.OS !== 'ios' || !refreshToken || !apiConfig.baseUrl || refreshToken === lastMirroredRefreshToken) {
    return;
  }
  try {
    await Keychain.setGenericPassword(USERNAME, shareExtensionSessionPayload(refreshToken), {
      service: SERVICE,
      accessGroup: SHARE_EXTENSION_ACCESS_GROUP,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    lastMirroredRefreshToken = refreshToken;
  } catch {
    // The extension then treats the person as signed out and hands the link to the app - never an error here.
  }
}

/** Removes the extension's copy (every sign-out / session loss). */
export async function clearShareExtensionSession(): Promise<void> {
  lastMirroredRefreshToken = null;
  if (Platform.OS !== 'ios') {
    return;
  }
  try {
    await Keychain.resetGenericPassword({ service: SERVICE, accessGroup: SHARE_EXTENSION_ACCESS_GROUP });
  } catch {
    // Nothing stored, or the Keychain is unavailable: nothing to remove.
  }
}
