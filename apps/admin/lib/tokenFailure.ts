/**
 * Telling a revoked sign-in apart from a passing failure (the same rule as apps/web/lib/sessionValidation.ts): only an error that
 * says "only an interactive sign-in can continue" ends the session; a network failure, timeout or outage never signs anyone out.
 */
const REAUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_grant',
  'interaction_required',
  'login_required',
  'consent_required',
  'no_tokens_found',
  'refresh_token_expired',
  'bad_token',
  'no_account_error',
]);

/** Classifies a failed silent token request by its name / errorCode only (never its message - it may echo request details). */
export function classifyTokenFailure(error: unknown): 'reauthRequired' | 'transient' {
  if (!error || typeof error !== 'object') {
    return 'transient';
  }
  const { name, errorCode } = error as { name?: unknown; errorCode?: unknown };
  if (name === 'InteractionRequiredAuthError') {
    return 'reauthRequired';
  }
  return typeof errorCode === 'string' && REAUTH_ERROR_CODES.has(errorCode) ? 'reauthRequired' : 'transient';
}

export class TokenUnavailableError extends Error {
  constructor() {
    super('An access token could not be obtained right now.');
    this.name = 'TokenUnavailableError';
  }
}
