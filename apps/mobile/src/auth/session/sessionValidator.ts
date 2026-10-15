/**
 * When to ask Entra whether the stored sign-in still stands (kept free of React and AppState so it is unit-tested directly).
 *
 * Entra External ID ends every sign-in session and refresh token issued before a password reset. The access token already in memory
 * stays valid until it expires (60-90 minutes), so the app would not notice on its own until then. AuthContext therefore forces one
 * refresh (getValidAccessToken({ forceRefresh: true })) when the app returns to the foreground and every few minutes while it is in
 * use - never per API call. A rejected refresh is reported by authSessionManager's onSessionInvalidated (the only path that may end the
 * session); a network failure, timeout or outage changes nothing.
 */

/** Returning to the foreground: at most once a minute. */
export const FOREGROUND_CHECK_INTERVAL_MS = 60_000;
/** While the app stays in the foreground: at most every five minutes. */
export const ACTIVE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface SessionValidator {
  /**
   * Runs `validate` unless a check started less than `minIntervalMs` ago (0 = always) or one is still running (that one is awaited).
   * Never throws: a failed check is just a failed check - what it means is decided by the session manager.
   */
  check(minIntervalMs: number): Promise<'checked' | 'skipped'>;
}

export function createSessionValidator(options: {
  readonly validate: () => Promise<unknown>;
  readonly now?: () => number;
}): SessionValidator {
  const now = options.now ?? (() => Date.now());
  let lastCheckAt: number | null = null;
  let inFlight: Promise<'checked'> | null = null;

  return {
    async check(minIntervalMs) {
      if (inFlight) {
        return inFlight;
      }
      const started = now();
      if (lastCheckAt !== null && started - lastCheckAt < minIntervalMs) {
        return 'skipped';
      }
      lastCheckAt = started;
      const running = options.validate().then(
        () => 'checked' as const,
        () => 'checked' as const,
      );
      inFlight = running;
      try {
        return await running;
      } finally {
        inFlight = null;
      }
    },
  };
}
