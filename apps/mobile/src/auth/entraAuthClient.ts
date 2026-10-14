import {
  authorize,
  logout,
  refresh,
  type AppAuthError,
  type AuthorizeResult,
  type RefreshResult,
} from 'react-native-app-auth';
import { selectedEntraAuthConfig } from './entraAuthConfig';

export class EntraAuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EntraAuthError';
  }
}

/** OAuth token-exchange error codes (react-native-app-auth AppAuthError) that mean the session is truly invalid. */
const SESSION_INVALID_ERROR_CODES = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'invalid_request',
]);

/**
 * Best-effort check for a session that must be discarded (revoked/expired refresh token),
 * as opposed to a transient network failure that should be retried later.
 */
export function isEntraSessionInvalidError(error: unknown): boolean {
  const code = (error as Partial<AppAuthError> | undefined)?.code;
  return typeof code === 'string' && SESSION_INVALID_ERROR_CODES.has(code);
}

/**
 * Forces a genuinely interactive sign-in: prompt=login makes Entra ignore any existing browser SSO
 * session, and max_age=0 asks it to treat any previous authentication as too old. Whether the
 * resulting access token's auth_time really moves is exactly what the DEV observer measures - the
 * app itself never treats a completed re-authentication as proof of anything.
 */
export const REAUTHENTICATION_PARAMETERS: Readonly<Record<string, string>> = {
  prompt: 'login',
  max_age: '0',
};

/**
 * The ordinary sign-in: prompt=select_account makes Entra show its account picker (and "use another
 * account") instead of silently continuing with whichever account the browser's SSO session holds - so a
 * person who signed out can choose a different account without clearing any browser data. Deliberately
 * no login_hint (that would pre-select one account) and no max_age; the same-account re-authentication
 * above is a separate flow and keeps prompt=login / max_age=0 / login_hint.
 */
export const SIGN_IN_PARAMETERS: Readonly<Record<string, string>> = {
  prompt: 'select_account',
};

/**
 * Runs the Authorization Code + PKCE flow against Microsoft Entra External ID.
 * Does not persist, log, or decode any token. Callers own what happens next.
 */
export async function authorizeWithEntra(
  additionalParameters?: Readonly<Record<string, string>>,
): Promise<AuthorizeResult> {
  const config = selectedEntraAuthConfig;

  try {
    return await authorize({
      issuer: config.issuer,
      serviceConfiguration: {
        authorizationEndpoint: config.authorizationEndpoint,
        tokenEndpoint: config.tokenEndpoint,
        endSessionEndpoint: config.endSessionEndpoint,
      },
      clientId: config.clientId,
      redirectUrl: config.redirectUrl,
      scopes: [...config.scopes],
      usePKCE: true,
      useNonce: true,
      // A fresh copy each call - the native side consumes/mutates the map it is handed.
      ...(additionalParameters ? { additionalParameters: { ...additionalParameters } } : {}),
    });
  } catch (error) {
    throw new EntraAuthError(
      'Microsoft Entra authorization failed. Check network connectivity and Entra app registration configuration.',
      error,
    );
  }
}

/**
 * Exchanges a stored refresh token for a new access token via react-native-app-auth's
 * official refresh API. Never performs a direct HTTP call to the token endpoint.
 */
export async function refreshEntraSession(
  refreshToken: string,
): Promise<RefreshResult> {
  const config = selectedEntraAuthConfig;

  try {
    return await refresh(
      {
        issuer: config.issuer,
        serviceConfiguration: {
          authorizationEndpoint: config.authorizationEndpoint,
          tokenEndpoint: config.tokenEndpoint,
          endSessionEndpoint: config.endSessionEndpoint,
        },
        clientId: config.clientId,
        redirectUrl: config.redirectUrl,
        scopes: [...config.scopes],
        usePKCE: true,
        useNonce: true,
      },
      { refreshToken },
    );
  } catch (error) {
    throw new EntraAuthError(
      'Microsoft Entra session refresh failed.',
      error,
    );
  }
}


/**
 * Ends the browser's Entra session (the sign-in cookies the account picker reads) for the account the ID token names.
 * Only used after the account was DELETED: Juple does not delete the Entra identity, so without this the browser keeps
 * offering the deleted account as "signed in" and one tap would sign straight back in (an ordinary sign-out deliberately
 * keeps the picker, so a person can pick another account without clearing browser data). The post-logout redirect is the
 * app's already-registered redirect URI. Best effort and never throws: a cancelled or failed browser step changes nothing
 * about the local sign-out that already happened.
 */
export async function endEntraBrowserSession(idToken: string | null | undefined): Promise<boolean> {
  if (!idToken) {
    return false;
  }
  const config = selectedEntraAuthConfig;
  try {
    await logout(
      {
        issuer: config.issuer,
        serviceConfiguration: {
          authorizationEndpoint: config.authorizationEndpoint,
          tokenEndpoint: config.tokenEndpoint,
          endSessionEndpoint: config.endSessionEndpoint,
        },
        clientId: config.clientId,
      },
      { idToken, postLogoutRedirectUrl: config.redirectUrl },
    );
    return true;
  } catch {
    return false;
  }
}
