import {
  authorize,
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
 * Runs the Authorization Code + PKCE flow against Microsoft Entra External ID.
 * Does not persist, log, or decode any token. Callers own what happens next.
 */
export async function authorizeWithEntra(): Promise<AuthorizeResult> {
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

