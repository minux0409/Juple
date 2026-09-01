export type AuthSessionErrorKind = 'sessionUnavailable';

/**
 * Thrown by authSessionManager when there is no auth session in secure storage to use - the
 * user is signed out, has never signed in, or the session was cleared. Distinct from a failed
 * refresh of an existing session (network/timeout, or an invalid/revoked session - see
 * isEntraSessionInvalidError), which is not a sessionUnavailable case.
 */
export class AuthSessionError extends Error {
  constructor(readonly kind: AuthSessionErrorKind) {
    super('No Juple auth session is available.');
    this.name = 'AuthSessionError';
  }
}
