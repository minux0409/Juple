import * as Keychain from 'react-native-keychain';
import type { AuthSession } from './authSessionTypes';

/** Dedicated Keychain/Keystore service for the Juple auth session; never shared with other data. */
const SESSION_SERVICE = 'com.juple.app.auth.session';

/** Fixed internal identifier; never a user email or other personal identifier. */
const SESSION_USERNAME = 'juple-mobile-session';

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await Keychain.setGenericPassword(SESSION_USERNAME, JSON.stringify(session), {
    service: SESSION_SERVICE,
  });
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  const credentials = await Keychain.getGenericPassword({
    service: SESSION_SERVICE,
  });

  if (!credentials) {
    return null;
  }

  try {
    const parsed = JSON.parse(credentials.password) as Partial<AuthSession>;
    if (!parsed.refreshToken) {
      return null;
    }
    return { refreshToken: parsed.refreshToken, idToken: parsed.idToken };
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
}
