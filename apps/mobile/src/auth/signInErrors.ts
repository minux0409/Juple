/**
 * True when the person closed or backed out of the sign-in browser. react-native-app-auth reports that as a "user cancelled"
 * error (code `user_cancelled` / message "User cancelled flow"); authorizeWithEntra wraps every failure in an EntraAuthError whose
 * own message is generic, so the original is looked at too. A dismissed sign-in sheet counts the same. Closing the sign-in page
 * is a choice, not a failure.
 */
export function isUserCancelledSignIn(caughtError: unknown): boolean {
  const candidates: unknown[] = [caughtError, (caughtError as { cause?: unknown } | null)?.cause];
  return candidates.some(candidate => {
    const { message, code } = (candidate ?? {}) as { message?: unknown; code?: unknown };
    return (typeof message === 'string' && /cancel|dismiss/i.test(message)) || (typeof code === 'string' && /cancel|dismiss/i.test(code));
  });
}
