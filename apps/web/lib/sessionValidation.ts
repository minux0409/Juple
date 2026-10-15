/**
 * Telling a REVOKED sign-in apart from a passing failure (kept pure for tests; msalClient.ts and app/(app)/AppRoot.tsx use it).
 *
 * Entra External ID ends every sign-in session and refresh token issued before a password reset (signInSessionsValidFromDateTime).
 * An access token already handed out stays valid until it expires (60-90 minutes) - nothing in the browser can see the revocation
 * until it asks Entra for a token again. So the app asks (a forced silent refresh) at a few moments - after the bootstrap, when the
 * tab becomes visible or focused again, and at most every few minutes while it is in use - and only an answer that says "only an
 * interactive sign-in can continue" asks the person to sign in again. A network failure, a timeout or an outage never signs anyone
 * out: the page simply offers a retry.
 */

/** valid = Entra issued a token; reauthRequired = only an interactive sign-in can continue; transient = could not tell (try later). */
export type SessionCheck = 'valid' | 'reauthRequired' | 'transient';

/**
 * MSAL error codes (InteractionRequiredAuthErrorCodes / the token endpoint's own error) that mean the session itself is gone: the
 * refresh token was rejected (invalid_grant - e.g. revoked by a password reset) and Entra's sign-in session cannot sign the person in
 * silently either. Anything else (no_network_connectivity, post_request_failed, monitor_window_timeout, a 5xx ...) is transient.
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
export function classifyTokenFailure(error: unknown): Exclude<SessionCheck, 'valid'> {
  if (!error || typeof error !== 'object') {
    return 'transient';
  }
  const { name, errorCode } = error as { name?: unknown; errorCode?: unknown };
  if (name === 'InteractionRequiredAuthError') {
    return 'reauthRequired';
  }
  return typeof errorCode === 'string' && REAUTH_ERROR_CODES.has(errorCode) ? 'reauthRequired' : 'transient';
}

/** A silent token request failed for a reason that is not "sign in again" (network, timeout, outage): the session is kept. */
export class TokenUnavailableError extends Error {
  constructor() {
    super('An access token could not be obtained right now.');
    this.name = 'TokenUnavailableError';
  }
}

/** Visibility / focus checks: at most once a minute. */
export const FOCUS_CHECK_INTERVAL_MS = 60_000;
/** While the tab is visible and in use: at most every five minutes. */
export const ACTIVE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface SessionValidator {
  /**
   * Asks Entra whether the session still stands, unless a check started less than `minIntervalMs` ago (0 = always) or one is already
   * running (that one's answer is returned). Once a check said reauthRequired, every later call answers that without asking again.
   */
  check(minIntervalMs: number): Promise<SessionCheck | 'skipped'>;
}

/**
 * Throttled, single-flight session checks. The last check time lives in memory only (a reload starts over, and a reload is itself a
 * moment worth checking). `onReauthRequired` runs at most once.
 */
export function createSessionValidator(options: {
  readonly validate: () => Promise<SessionCheck>;
  readonly onReauthRequired: () => void;
  readonly now?: () => number;
}): SessionValidator {
  const now = options.now ?? (() => Date.now());
  let lastCheckAt: number | null = null;
  let inFlight: Promise<SessionCheck> | null = null;
  let revoked = false;

  return {
    async check(minIntervalMs) {
      if (revoked) {
        return 'reauthRequired';
      }
      if (inFlight) {
        return inFlight;
      }
      const started = now();
      if (lastCheckAt !== null && started - lastCheckAt < minIntervalMs) {
        return 'skipped';
      }
      lastCheckAt = started;
      inFlight = options.validate().then(
        result => result,
        () => 'transient' as const,
      );
      try {
        const result = await inFlight;
        if (result === 'reauthRequired' && !revoked) {
          revoked = true;
          options.onReauthRequired();
        }
        return result;
      } finally {
        inFlight = null;
      }
    },
  };
}
