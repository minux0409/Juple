/** NSError domain of iOS's ASWebAuthenticationSession (the sign-in sheet AppAuth presents). */
const WEB_AUTH_SESSION_DOMAIN = 'com.apple.AuthenticationServices.WebAuthenticationSession';
/** ASWebAuthenticationSessionError codes: the person cancelled; the sheet could not be presented at all. */
const WEB_AUTH_CANCELED_LOGIN = '1';
const WEB_AUTH_PRESENTATION_FAILURES: ReadonlySet<string> = new Set(['2', '3']);

/**
 * The ASWebAuthenticationSession error code behind an iOS sign-in failure, or null. AppAuth-iOS turns EVERY session error without a
 * callback (a cancel, but also a sheet that could not be presented) into its own "user canceled" error, and react-native-app-auth
 * rejects that with the generic code `authentication_failed` - the only place the real reason survives is the underlying NSError,
 * which React Native forwards as `userInfo.NSUnderlyingError` ({ domain, code }).
 */
function webAuthenticationSessionCode(candidate: unknown): string | null {
  const underlying = (candidate as { userInfo?: { NSUnderlyingError?: { domain?: unknown; code?: unknown } } } | null)?.userInfo?.NSUnderlyingError;
  if (underlying?.domain !== WEB_AUTH_SESSION_DOMAIN) {
    return null;
  }
  return typeof underlying.code === 'string' || typeof underlying.code === 'number' ? String(underlying.code) : null;
}

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
    return (
      (typeof message === 'string' && /cancel|dismiss/i.test(message)) ||
      (typeof code === 'string' && /cancel|dismiss/i.test(code)) ||
      // iOS: 취소 on the system "...을(를) 사용하여 로그인하려고 합니다" prompt or closing the sheet arrives as authentication_failed.
      webAuthenticationSessionCode(candidate) === WEB_AUTH_CANCELED_LOGIN
    );
  });
}

/**
 * The sentence for a re-authentication that threw - every screen that asks for one says the same thing. Null for a cancel (each
 * screen decides whether a cancel is quiet); a real failure names its step, and is never reported as "not completed".
 */
export function reauthenticationFailureNotice(caughtError: unknown, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  if (isUserCancelledSignIn(caughtError)) {
    return null;
  }
  const code = signInFailureCode(caughtError);
  return code ? t('settings.collectionLockSignInFailed', { code }) : t('auth.failed');
}

/** AppAuth's own descriptions of a rejected ID token (iOS and Android), as fixed labels. */
const ID_TOKEN_CHECKS: readonly (readonly [RegExp, string])[] = [
  [/issuer mismatch/i, 'id_token_issuer'],
  [/audience mismatch/i, 'id_token_audience'],
  [/id token expired/i, 'id_token_expired'],
  [/issued at time/i, 'id_token_iat'],
  [/nonce mismatch/i, 'id_token_nonce'],
  [/invalid id token|id token .*invalid|id_token/i, 'id_token_invalid'],
  [/state mismatch|state.*did not match/i, 'state_mismatch'],
  [/network|offline|connection|timed out/i, 'network'],
];

/**
 * A short, safe code for a failed (not cancelled) sign-in - so a failure on a real device names its step instead of hiding behind
 * one generic sentence: the OAuth error code AppAuth reports (e.g. invalid_grant, access_denied), Entra's AADSTS number from its
 * error description, which ID-token check AppAuth refused, or (iOS) why the sign-in sheet failed (web_auth_presentation: it could
 * not be shown at all). Only fixed labels, a lowercase OAuth code and digits ever come out -
 * never a token, an e-mail or any other text from the response. Null when nothing recognisable is there.
 */
export function signInFailureCode(caughtError: unknown): string | null {
  const candidates: unknown[] = [caughtError, (caughtError as { cause?: unknown } | null)?.cause];
  const parts: string[] = [];
  for (const candidate of candidates) {
    const { message, code, name } = (candidate ?? {}) as { message?: unknown; code?: unknown; name?: unknown };
    if (typeof code === 'string' && /^[a-z_]{3,40}$/.test(code) && !parts.includes(code)) {
      parts.push(code);
    }
    const webAuthCode = webAuthenticationSessionCode(candidate);
    if (webAuthCode !== null && /^\d{1,4}$/.test(webAuthCode)) {
      const label = WEB_AUTH_PRESENTATION_FAILURES.has(webAuthCode) ? 'web_auth_presentation' : `web_auth_${webAuthCode}`;
      if (!parts.includes(label)) {
        parts.push(label);
      }
    }
    // The app's own wrapper (EntraAuthError) carries only a generic sentence of its own; the native error it wraps is what counts.
    if (typeof message === 'string' && name !== 'EntraAuthError') {
      const aadsts = /AADSTS(\d{4,8})/.exec(message);
      if (aadsts && !parts.includes(`AADSTS${aadsts[1]}`)) {
        parts.push(`AADSTS${aadsts[1]}`);
      }
      const check = ID_TOKEN_CHECKS.find(([pattern]) => pattern.test(message));
      if (check && !parts.includes(check[1])) {
        parts.push(check[1]);
      }
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
