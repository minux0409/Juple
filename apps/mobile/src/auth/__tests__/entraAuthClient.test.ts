import { authorize, refresh } from 'react-native-app-auth';
import {
  authorizeWithEntra,
  isEntraSessionInvalidError,
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
