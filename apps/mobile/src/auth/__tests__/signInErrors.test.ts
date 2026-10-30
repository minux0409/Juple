import { isUserCancelledSignIn, signInFailureCode } from '../signInErrors';

const wrapped = (cause: unknown) => ({ name: 'EntraAuthError', message: 'Microsoft Entra authorization failed. Check network connectivity and Entra app registration configuration.', cause });

describe('signInFailureCode - names the failing step, safely', () => {
  it('reports the OAuth code and the AADSTS number of a refused token exchange', () => {
    expect(signInFailureCode(wrapped({ code: 'invalid_grant', message: 'AADSTS54005: OAuth2 Authorization code was already redeemed.' }))).toBe('invalid_grant · AADSTS54005');
  });

  it.each([
    ['Issuer mismatch', 'id_token_issuer'],
    ['Audience mismatch', 'id_token_audience'],
    ['ID Token expired', 'id_token_expired'],
    ['Issued at time is more than 600 seconds before or after the current time', 'id_token_iat'],
    ['Nonce mismatch', 'id_token_nonce'],
    ['Connection error making token request to \'https://juple.ciamlogin.com/x\': The Internet connection appears to be offline.', 'network'],
  ])('labels AppAuth\'s "%s" as %s', (message, label) => {
    expect(signInFailureCode(wrapped({ code: 'authentication_failed', message }))).toBe(`authentication_failed · ${label}`);
  });

  it('never reads the app wrapper\'s own generic sentence (it mentions "network" for every failure)', () => {
    expect(signInFailureCode(wrapped({}))).toBeNull();
  });

  it('a stored-session failure after a good sign-in has its own label', () => {
    expect(signInFailureCode({ code: 'session_save', message: 'The re-authenticated session could not be stored.' })).toBe('session_save');
  });

  it('never lets anything but fixed labels, a lowercase OAuth code or digits out - no token, e-mail or free text', () => {
    const code = signInFailureCode(wrapped({ code: 'eyJhbGciOi.secret.TOKEN', message: 'user someone@example.com token=abc.def.ghi AADSTS50126 Invalid username or password' }));
    expect(code).toBe('AADSTS50126');
    expect(code).not.toMatch(/@|eyJ|abc|secret/);
  });

  it('a cancel is still a cancel (and is not reported as a failure by the screens)', () => {
    expect(isUserCancelledSignIn(wrapped({ code: 'authentication_failed', message: 'The user cancelled the flow' }))).toBe(true);
  });
});

describe('iOS ASWebAuthenticationSession errors (reported by react-native-app-auth as authentication_failed)', () => {
  // What React Native hands JS for AppAuth's wrapped session error: the generic code, AppAuth's domain, the session error underneath.
  const iosSessionError = (sessionCode: string) =>
    wrapped({
      code: 'authentication_failed',
      domain: 'org.openid.appauth.general',
      message: 'The operation couldn’t be completed.',
      userInfo: { NSUnderlyingError: { code: sessionCode, domain: 'com.apple.AuthenticationServices.WebAuthenticationSession', message: 'underlying error' } },
    });

  it('취소 on the system sign-in prompt (or closing the sheet) is a cancel, not a failure', () => {
    expect(isUserCancelledSignIn(iosSessionError('1'))).toBe(true);
  });

  it('a sheet that could not be presented is a failure, named web_auth_presentation', () => {
    for (const code of ['2', '3']) {
      expect(isUserCancelledSignIn(iosSessionError(code))).toBe(false);
      expect(signInFailureCode(iosSessionError(code))).toBe('authentication_failed · web_auth_presentation');
    }
  });

  it('another session error keeps its number; an unrelated underlying error adds nothing', () => {
    expect(signInFailureCode(iosSessionError('4'))).toBe('authentication_failed · web_auth_4');
    expect(isUserCancelledSignIn(wrapped({ code: 'authentication_failed', userInfo: { NSUnderlyingError: { code: '1', domain: 'NSURLErrorDomain' } } }))).toBe(false);
    expect(signInFailureCode(wrapped({ code: 'authentication_failed', userInfo: { NSUnderlyingError: { code: '1', domain: 'NSURLErrorDomain' } } }))).toBe('authentication_failed');
  });
});
