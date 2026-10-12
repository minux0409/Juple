/**
 * Turning an MSAL / sign-in failure into (a) what the person is told and (b) a non-sensitive diagnostic for developers. Only the
 * error's name, code, sub-error and correlation id are ever read - never its message (which can carry URLs) and never any token.
 */
export type SignInFailureKind = 'configuration' | 'cancelled' | 'retryable';

export interface SignInDiagnostic {
  readonly name: string;
  readonly errorCode: string | null;
  readonly subError: string | null;
  readonly correlationId: string | null;
}

function stringField(error: unknown, field: string): string | null {
  if (error && typeof error === 'object' && field in error) {
    const value = (error as Record<string, unknown>)[field];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  return null;
}

export function describeSignInError(error: unknown): SignInDiagnostic {
  return {
    name: error instanceof Error ? error.name : typeof error,
    errorCode: stringField(error, 'errorCode'),
    subError: stringField(error, 'subError'),
    correlationId: stringField(error, 'correlationId'),
  };
}

/** Codes that mean this app's sign-in configuration is wrong - retrying will not help, so they are never shown as a transient failure. */
const CONFIGURATION_CODES = new Set([
  'invalid_authority_type',
  'invalid_cloud_discovery_metadata',
  'untrusted_authority',
  'endpoints_resolution_error',
  'issuer_validation_failed',
  'url_parse_error',
  'empty_url_error',
  'invalid_request',
  'unauthorized_client',
  'invalid_client',
  'redirect_uri_empty',
  'empty_navigate_uri',
  'invalid_grant_type',
]);

const CANCEL_CODES = new Set(['user_cancelled', 'access_denied']);

/** What the person is told for each kind of failure (all of them can be retried; only "configuration" says retrying alone will not fix it). */
export function signInFailureMessage(
  error: unknown,
  dictionary: { readonly signInFailed: string; readonly signInCancelled: string; readonly signInConfigError: string },
): string {
  switch (classifySignInError(error)) {
    case 'configuration':
      return dictionary.signInConfigError;
    case 'cancelled':
      return dictionary.signInCancelled;
    default:
      return dictionary.signInFailed;
  }
}

export function classifySignInError(error: unknown): SignInFailureKind {
  const { errorCode, subError } = describeSignInError(error);
  if ((errorCode && CANCEL_CODES.has(errorCode)) || subError === 'cancel') {
    return 'cancelled';
  }
  if (errorCode && CONFIGURATION_CODES.has(errorCode)) {
    return 'configuration';
  }
  return 'retryable';
}
