import { authorize, refresh } from 'react-native-app-auth';
import {
  authorizeWithEntra,
  isEntraSessionInvalidError,
  REAUTHENTICATION_PARAMETERS,
  refreshEntraSession,
} from '../entraAuthClient';
import { entraDevAuthConfig } from '../entraAuthConfig';

jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
}));

describe('entraAuthClient', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // In this Jest environment __DEV__ is true, so selectedEntraAuthConfig resolves to
  // entraDevAuthConfig (see entraAuthConfig.ts's resolveEntraAuthConfig()) - this is exactly the
  // config a real Debug build would select too, so asserting against it here is not a test-only
  // stand-in.

  it('authorizeWithEntra calls react-native-app-auth.authorize with the selected config, unchanged shape', async () => {
    jest.mocked(authorize).mockResolvedValue({
      accessToken: 'token',
      accessTokenExpirationDate: '2099-01-01T00:00:00.000Z',
      refreshToken: 'refresh',
      idToken: 'id',
      tokenType: 'Bearer',
      scopes: [],
      authorizationCode: '',
      additionalParameters: undefined,
    } as never);

    await authorizeWithEntra();

    expect(authorize).toHaveBeenCalledWith({
      issuer: entraDevAuthConfig.issuer,
      serviceConfiguration: {
        authorizationEndpoint: entraDevAuthConfig.authorizationEndpoint,
        tokenEndpoint: entraDevAuthConfig.tokenEndpoint,
        endSessionEndpoint: entraDevAuthConfig.endSessionEndpoint,
      },
      clientId: entraDevAuthConfig.clientId,
      redirectUrl: entraDevAuthConfig.redirectUrl,
      scopes: [...entraDevAuthConfig.scopes],
      usePKCE: true,
      useNonce: true,
    });
  });

  it('a re-authentication passes prompt=login and max_age=0 as additionalParameters, and nothing else changes', async () => {
    jest.mocked(authorize).mockResolvedValue({ accessToken: 'token' } as never);

    await authorizeWithEntra(REAUTHENTICATION_PARAMETERS);

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: entraDevAuthConfig.clientId,
        scopes: [...entraDevAuthConfig.scopes],
        usePKCE: true,
        useNonce: true,
        additionalParameters: { prompt: 'login', max_age: '0' },
      }),
    );
    // A copy - the shared constant is never handed to (and mutated by) the native side.
    expect(jest.mocked(authorize).mock.calls[0][0].additionalParameters).not.toBe(REAUTHENTICATION_PARAMETERS);
  });

  it('refreshEntraSession calls react-native-app-auth.refresh with the selected config, unchanged shape', async () => {
    jest.mocked(refresh).mockResolvedValue({
      accessToken: 'new-token',
      accessTokenExpirationDate: '2099-01-01T00:00:00.000Z',
      refreshToken: 'new-refresh',
      idToken: 'id',
      tokenType: 'Bearer',
      scopes: [],
      additionalParameters: undefined,
    } as never);

    await refreshEntraSession('old-refresh');

    expect(refresh).toHaveBeenCalledWith(
      {
        issuer: entraDevAuthConfig.issuer,
        serviceConfiguration: {
          authorizationEndpoint: entraDevAuthConfig.authorizationEndpoint,
          tokenEndpoint: entraDevAuthConfig.tokenEndpoint,
          endSessionEndpoint: entraDevAuthConfig.endSessionEndpoint,
        },
        clientId: entraDevAuthConfig.clientId,
        redirectUrl: entraDevAuthConfig.redirectUrl,
        scopes: [...entraDevAuthConfig.scopes],
        usePKCE: true,
        useNonce: true,
      },
      { refreshToken: 'old-refresh' },
    );
  });

  it('isEntraSessionInvalidError is unaffected by this change (still recognizes invalid_grant)', () => {
    expect(isEntraSessionInvalidError({ code: 'invalid_grant' })).toBe(true);
    expect(isEntraSessionInvalidError({ code: 'network_error' })).toBe(false);
  });
});
