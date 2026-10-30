import { authorize } from 'react-native-app-auth';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
// Initializes i18next so AuthProvider's own useTranslation() call has a real instance - otherwise
// react-i18next only warns (this test never asserts on translated text either way).
import '../../i18n';
import { AuthProvider, useAuth } from '../AuthContext';
import { EntraAuthError } from '../entraAuthClient';
import { clearSession, getValidAccessToken, saveAuthorizedSession } from '../session/authSessionManager';
import { validateBackendSession } from '../authSessionApi';
import { bootstrapCurrentUser } from '../userBootstrapApi';
import { collectionShortcutService } from '../../shortcuts/CollectionShortcutService';

jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
}));

jest.mock('../session/authSessionManager', () => ({
  // Pass-throughs: an interactive sign-in only runs its callback (see authSessionManager.runInteractiveSignIn).
  runInteractiveSignIn: jest.fn((signIn: () => Promise<unknown>) => signIn()),
  isInteractiveSignInInProgress: jest.fn(() => false),
  getValidAccessToken: jest.fn(),
  getCachedIdToken: jest.fn(() => null),
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

// The app shortcuts carry Collection names: every way out of a session must clear them.
jest.mock('../../shortcuts/CollectionShortcutService', () => ({
  collectionShortcutService: { clear: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../push/pushLogoutUnregister', () => ({
  unregisterCurrentPushDeviceBestEffort: jest.fn(),
}));

// While signed in the provider runs a periodic session check (an interval): every tree is unmounted after its test so none outlives it.
const mountedTrees: ReactTestRenderer.ReactTestRenderer[] = [];
const createTree = ReactTestRenderer.create;
beforeAll(() => {
  jest.spyOn(ReactTestRenderer, 'create').mockImplementation(((...args: Parameters<typeof createTree>) => {
    const tree = createTree(...args);
    mountedTrees.push(tree);
    return tree;
  }) as typeof createTree);
});
afterEach(async () => {
  await act(async () => {
    mountedTrees.splice(0).forEach(tree => tree.unmount());
  });
});

/** Renders just enough of useAuth()'s state to assert on, via a plain react-test-renderer tree. */
function AuthStateProbe() {
  const { isAuthenticated, backendAuthStatus, sessionRestoreStep } = useAuth();
  return <Text>{`${isAuthenticated}:${backendAuthStatus}:${sessionRestoreStep}`}</Text>;
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

describe('AuthProvider sign-in', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('asks Entra for the sign-in page (prompt=login: no remembered-account tiles) and sends no login_hint or max_age', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));
    jest.mocked(authorize).mockRejectedValue(new Error('cancelled'));
    let signIn!: () => Promise<void>;
    function SignInProbe() {
      signIn = useAuth().signIn;
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(
        <AuthProvider>
          <SignInProbe />
        </AuthProvider>,
      );
    });

    await act(async () => {
      await signIn().catch(() => undefined);
    });

    expect(authorize).toHaveBeenCalledTimes(1);
    const parameters = jest.mocked(authorize).mock.calls[0][0].additionalParameters;
    expect(parameters).toEqual({ prompt: 'login' });
    expect(parameters).not.toHaveProperty('login_hint');
    expect(parameters).not.toHaveProperty('max_age');
  });
});

describe('AuthProvider bootstrap - session restore failure handling', () => {
  beforeEach(() => {
    // Only the two tests that actually reach backendAuthStatus 'valid' exercise this call - a
    // plain default so they don't crash on an unmocked resolved value; neither asserts on plan.
    jest.mocked(bootstrapCurrentUser).mockResolvedValue({ status: 'ready', plan: 'Free', entitlement: null });
  });

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

    expect(readProbeText(renderer)).toBe('true:unavailable:sessionRestore');
    expect(validateBackendSession).not.toHaveBeenCalled();
  });

  it('signs out on a genuine Entra rejection of the stored session', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(
      new EntraAuthError('Microsoft Entra session refresh failed.', {
        code: 'invalid_grant',
      }),
    );

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('false:notChecked:sessionRestore');
  });

  it('signs out when there is no stored session at all (not an EntraAuthError)', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('false:notChecked:sessionRestore');
  });

  it('clears the Collection app shortcuts whenever the session ends, so the next account never sees their names', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));

    await renderAuthProvider();

    expect(collectionShortcutService.clear).toHaveBeenCalled();
  });

  it('keeps the Collection app shortcuts while the session is valid', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');

    await renderAuthProvider();

    expect(collectionShortcutService.clear).not.toHaveBeenCalled();
  });

  it('keeps existing behavior for a normal, successful refresh', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('true:valid:sessionRestore');
  });

  it('reports the real sessionRestore -> entraRefresh sub-phases as getValidAccessToken reaches them', async () => {
    let capturedOnStep!: (step: 'sessionRestore' | 'entraRefresh') => void;
    let resolveToken!: (token: string) => void;
    jest.mocked(getValidAccessToken).mockImplementation(options => {
      capturedOnStep = options!.onStep!;
      return new Promise(resolve => {
        resolveToken = resolve;
      });
    });
    jest.mocked(validateBackendSession).mockResolvedValue('valid');

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AuthProvider>
          <AuthStateProbe />
        </AuthProvider>,
      );
    });

    // Still restoring - the step hasn't advanced past the default yet.
    expect(readProbeText(renderer)).toBe('false:notChecked:sessionRestore');

    await act(async () => {
      capturedOnStep('entraRefresh');
    });
    expect(readProbeText(renderer)).toBe('false:notChecked:entraRefresh');

    await act(async () => {
      resolveToken('a-valid-token');
    });
    expect(readProbeText(renderer)).toBe('true:valid:entraRefresh');
  });
});

/** Captures the entitlement/plan the provider exposes - this round only makes it available; nothing on screen reads it. */
function EntitlementProbe({ onValue }: { onValue: (value: { plan: unknown; entitlement: unknown; status: string }) => void }) {
  const { plan, entitlement, userBootstrapStatus } = useAuth();
  onValue({ plan, entitlement, status: userBootstrapStatus });
  return null;
}

async function renderEntitlementProbe() {
  const seen: { plan: unknown; entitlement: unknown; status: string }[] = [];
  await act(async () => {
    ReactTestRenderer.create(
      <AuthProvider>
        <EntitlementProbe onValue={value => seen.push(value)} />
      </AuthProvider>,
    );
  });
  return seen;
}

describe('AuthProvider bootstrap - entitlement state', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the entitlement alongside the legacy plan once bootstrap is ready', async () => {
    const entitlement = {
      programEnabled: true,
      status: 'trial',
      reason: 'none',
      trialStartedAtUtc: '2026-12-01T00:00:00+00:00',
      trialEndsAtUtc: '2026-12-31T00:00:00+00:00',
      currentPeriodEndsAtUtc: null,
      accessFrozenAtUtc: null,
      canWrite: true,
      verifiedAtUtc: '2026-12-05T00:00:00+00:00',
    };
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValue({ status: 'ready', plan: 'Free', entitlement } as never);

    const seen = await renderEntitlementProbe();

    expect(seen[seen.length - 1]).toEqual({ plan: 'Free', entitlement, status: 'ready' });
  });

  it('starts with no entitlement (nothing is guessed before the server answers)', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('offline'));

    const seen = await renderEntitlementProbe();

    expect(seen[0].entitlement).toBeNull();
    expect(seen[0].plan).toBeNull();
  });

  it('an older backend (no entitlement) leaves it null while the plan and bootstrap still work', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValue({ status: 'ready', plan: 'Free', entitlement: null });

    const seen = await renderEntitlementProbe();

    expect(seen[seen.length - 1]).toEqual({ plan: 'Free', entitlement: null, status: 'ready' });
  });
});

describe('AuthProvider - refreshEntitlement (after a server-verified purchase)', () => {
  const trial = (status: string, canWrite: boolean) => ({
    programEnabled: true,
    status,
    reason: 'none',
    trialStartedAtUtc: null,
    trialEndsAtUtc: null,
    currentPeriodEndsAtUtc: null,
    accessFrozenAtUtc: null,
    canWrite,
    verifiedAtUtc: '2026-12-05T00:00:00+00:00',
  });

  function RefreshProbe({ onValue }: { onValue: (value: { entitlement: unknown; refresh: () => Promise<void> }) => void }) {
    const { entitlement, refreshEntitlement } = useAuth();
    onValue({ entitlement, refresh: refreshEntitlement });
    return null;
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('re-reads only the entitlement from the server, with no startup states in between', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValueOnce({ status: 'ready', plan: 'Free', entitlement: trial('expired', false) } as never);
    let latest!: { entitlement: unknown; refresh: () => Promise<void> };
    await act(async () => {
      ReactTestRenderer.create(
        <AuthProvider>
          <RefreshProbe onValue={value => { latest = value; }} />
        </AuthProvider>,
      );
    });
    expect(latest.entitlement).toMatchObject({ status: 'expired', canWrite: false });

    jest.mocked(bootstrapCurrentUser).mockResolvedValueOnce({ status: 'ready', plan: 'Free', entitlement: trial('active', true) } as never);
    await act(async () => {
      await latest.refresh();
    });

    expect(latest.entitlement).toMatchObject({ status: 'active', canWrite: true });
  });

  it('a failed refresh keeps what it had and never throws', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValueOnce({ status: 'ready', plan: 'Free', entitlement: trial('trial', true) } as never);
    let latest!: { entitlement: unknown; refresh: () => Promise<void> };
    await act(async () => {
      ReactTestRenderer.create(
        <AuthProvider>
          <RefreshProbe onValue={value => { latest = value; }} />
        </AuthProvider>,
      );
    });

    jest.mocked(bootstrapCurrentUser).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await expect(latest.refresh()).resolves.toBeUndefined();
    });

    expect(latest.entitlement).toMatchObject({ status: 'trial' });
  });
});

describe('AuthProvider - an identity without a Juple account never gets one from a stale sign-in', () => {
  const STALE = { status: 'signInRequired', plan: null, entitlement: null } as const;
  const authorized = (token: string) => ({
    accessToken: token,
    accessTokenExpirationDate: '2099-01-01T00:00:00Z',
    refreshToken: `${token}-refresh`,
    idToken: 'id',
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('a restored session answered "sign in again" is dropped and the app is signed out (nothing is created)', async () => {
    jest.mocked(getValidAccessToken).mockResolvedValue('stale-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValue(STALE);

    const renderer = await renderAuthProvider();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(readProbeText(renderer)).toBe('false:notChecked:sessionRestore');
    expect(bootstrapCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('sign-in that is answered "sign in again" asks for the credentials (prompt=login, max_age) and then creates the account', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(authorize)
      .mockResolvedValueOnce(authorized('sso-token') as never)
      .mockResolvedValueOnce(authorized('fresh-token') as never);
    jest.mocked(bootstrapCurrentUser)
      .mockResolvedValueOnce(STALE)
      .mockResolvedValueOnce({ status: 'ready', plan: 'Free', entitlement: null });
    let signIn!: () => Promise<void>;
    function SignInProbe() {
      signIn = useAuth().signIn;
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<AuthProvider><SignInProbe /></AuthProvider>);
    });

    await act(async () => {
      await signIn();
    });

    expect(jest.mocked(authorize).mock.calls[0][0].additionalParameters).toEqual({ prompt: 'login' });
    expect(jest.mocked(authorize).mock.calls[1][0].additionalParameters).toMatchObject({ prompt: 'login', max_age: '300' });
    expect(bootstrapCurrentUser).toHaveBeenLastCalledWith('fresh-token', expect.anything());
    expect(saveAuthorizedSession).toHaveBeenLastCalledWith(expect.objectContaining({ accessToken: 'fresh-token' }));
  });

  it('cancelling the credential prompt leaves no session behind', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(authorize)
      .mockResolvedValueOnce(authorized('sso-token') as never)
      .mockRejectedValueOnce(new Error('User cancelled flow'));
    jest.mocked(bootstrapCurrentUser).mockResolvedValue(STALE);
    let signIn!: () => Promise<void>;
    let state!: ReturnType<typeof useAuth>;
    function SignInProbe() {
      state = useAuth();
      signIn = state.signIn;
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<AuthProvider><SignInProbe /></AuthProvider>);
    });

    await act(async () => {
      await signIn();
    });

    expect(clearSession).toHaveBeenCalled();
    expect(state.isAuthenticated).toBe(false);
  });
});

describe('AuthProvider sign-in - cancelling is not an error', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function signInWith(rejection: unknown) {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));
    jest.mocked(authorize).mockRejectedValue(rejection);
    let state!: ReturnType<typeof useAuth>;
    function Probe() {
      state = useAuth();
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<AuthProvider><Probe /></AuthProvider>);
    });
    await act(async () => {
      await state.signIn();
    });
    return state;
  }

  it('closing the sign-in browser (react-native-app-auth user_cancelled, wrapped by authorizeWithEntra) shows no error', async () => {
    const state = await signInWith(Object.assign(new Error('User cancelled flow'), { code: 'user_cancelled' }));

    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBeNull();
  });

  it('a real failure still shows the failure message', async () => {
    const state = await signInWith(new Error('network down'));

    expect(state.isAuthenticated).toBe(false);
    expect(state.error).toBe('Sign-in failed. Please try again in a moment.');
  });
});

describe('AuthProvider - completing an account deletion', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  async function renderSignedIn() {
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValue({ status: 'ready', plan: 'Free', entitlement: null } as never);
    let completeAccountDeletion!: () => Promise<void>;
    function Probe() {
      const auth = useAuth();
      completeAccountDeletion = auth.completeAccountDeletion;
      return <Text>{`${auth.isAuthenticated}:${auth.isInitializing}`}</Text>;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
    });
    return { renderer, complete: () => completeAccountDeletion() };
  }

  it('lands on the signed-out sign-in state, clears the session and shortcuts, and never starts authentication or a browser', async () => {
    const { renderer, complete } = await renderSignedIn();
    expect(readProbeText(renderer)).toBe('true:false');

    await act(async () => {
      await complete();
    });

    expect(readProbeText(renderer)).toBe('false:false');
    expect(clearSession).toHaveBeenCalled();
    expect(collectionShortcutService.clear).toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('a local cleanup step that throws still ends on the signed-out state (the server deletion already succeeded)', async () => {
    const { renderer, complete } = await renderSignedIn();
    jest.mocked(clearSession).mockRejectedValueOnce(new Error('storage unavailable'));
    jest.mocked(collectionShortcutService.clear).mockRejectedValueOnce(new Error('shortcut service unavailable'));

    await act(async () => {
      await complete();
    });

    expect(readProbeText(renderer)).toBe('false:false');
    expect(authorize).not.toHaveBeenCalled();
  });

  it('a restart after the deletion (no stored session) is the sign-in state - nothing is started by itself', async () => {
    jest.mocked(getValidAccessToken).mockRejectedValue(new Error('sessionUnavailable'));

    const renderer = await renderAuthProvider();

    expect(readProbeText(renderer)).toBe('false:notChecked:sessionRestore');
    expect(authorize).not.toHaveBeenCalled();
  });
});
