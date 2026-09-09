import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
// Initializes i18next so AuthProvider's own useTranslation() call has a real instance - otherwise
// react-i18next only warns (this test never asserts on translated text either way).
import '../../i18n';
import { AuthProvider, useAuth } from '../AuthContext';
import { EntraAuthError } from '../entraAuthClient';
import { getValidAccessToken } from '../session/authSessionManager';
import { validateBackendSession } from '../authSessionApi';

jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
}));

jest.mock('../session/authSessionManager', () => ({
  getValidAccessToken: jest.fn(),
  onSessionInvalidated: jest.fn(() => jest.fn()),
  clearSession: jest.fn(),
  saveAuthorizedSession: jest.fn(),
}));

jest.mock('../authSessionApi', () => ({
  validateBackendSession: jest.fn(),
}));

jest.mock('../userBootstrapApi', () => ({
  bootstrapCurrentUser: jest.fn(),
}));

jest.mock('../../device/regionalSettings', () => ({
  getDeviceRegionalSettings: jest.fn(() => ({})),
}));

jest.mock('../../push/pushLogoutUnregister', () => ({
  unregisterCurrentPushDeviceBestEffort: jest.fn(),
}));

/** Renders just enough of useAuth()'s state to assert on, via a plain react-test-renderer tree. */
function AuthStateProbe() {
  const { isAuthenticated, backendAuthStatus } = useAuth();
  return <Text>{`${isAuthenticated}:${backendAuthStatus}`}</Text>;
}

async function renderAuthProvider() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AuthProvider>
        <AuthStateProbe />
      </AuthProvider>,
    );
  });
  return renderer;
}

function readProbeText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root.findByType(Text).props.children;
}

describe('AuthProvider bootstrap - session restore failure handling', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('does not sign out on a transient transport failure while restoring the session', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(
      new EntraAuthError('Microsoft Entra session refresh failed.', {
        code: 'network_error',
      }),
    );

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('true:unavailable');
    expect(validateBackendSession).not.toHaveBeenCalled();
  });

  it('signs out on a genuine Entra rejection of the stored session', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(
      new EntraAuthError('Microsoft Entra session refresh failed.', {
        code: 'invalid_grant',
      }),
    );

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('false:notChecked');
  });

  it('signs out when there is no stored session at all (not an EntraAuthError)', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('false:notChecked');
  });

  it('keeps existing behavior for a normal, successful refresh', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('true:valid');
  });
});
