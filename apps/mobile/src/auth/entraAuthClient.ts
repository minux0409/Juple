import { authorize, type AuthorizeResult } from 'react-native-app-auth';
import { entraDevAuthConfig } from './entraAuthConfig';

export class EntraAuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EntraAuthError';
  }
}

/**
 * Runs the Authorization Code + PKCE flow against Microsoft Entra External ID.
 * Does not persist, log, or decode any token. Callers own what happens next.
 */
export async function authorizeWithEntra(): Promise<AuthorizeResult> {
  const config = entraDevAuthConfig;

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
