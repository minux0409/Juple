jest.mock('../confirmMinimumAge', () => ({ confirmMinimumAge: jest.fn().mockResolvedValue(true) }));
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Text, type AppStateStatus } from 'react-native';
import '../../i18n';
import i18n from '../../i18n';
import { AuthProvider, useAuth } from '../AuthContext';
import { EntraAuthError } from '../entraAuthClient';
import { clearSession, getValidAccessToken, onSessionInvalidated } from '../session/authSessionManager';
import { validateBackendSession } from '../authSessionApi';
import { bootstrapCurrentUser } from '../userBootstrapApi';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { createSessionValidator } from '../session/sessionValidator';

jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
}));

jest.mock('../session/authSessionManager', () => ({
  getValidAccessToken: jest.fn(),
  getCachedIdToken: jest.fn(() => null),
  onSessionInvalidated: jest.fn(() => jest.fn()),
  clearSession: jest.fn().mockResolvedValue(undefined),
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

function Probe() {
  const { isAuthenticated, backendAuthStatus } = useAuth();
  return <Text testID="probe">{`${isAuthenticated}:${backendAuthStatus}`}</Text>;
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;
let invalidated: (() => void) | null = null;

async function renderSignedIn() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  });
  return renderer;
}

const probe = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByProps({ testID: 'probe' }).props.children;
const dialogs = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(ConfirmDialog);

async function comeToForeground() {
  await act(async () => {
    appStateListener?.('background');
    appStateListener?.('active');
  });
}

const forcedRefreshCalls = () => jest.mocked(getValidAccessToken).mock.calls.filter(([options]) => options?.forceRefresh === true).length;

describe('AuthProvider - revoked sign-in sessions', () => {
  let now = 1_000_000;
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    now = 1_000_000;
    spies.push(jest.spyOn(Date, 'now').mockImplementation(() => now));
    appStateListener = null;
    invalidated = null;
    spies.push(
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
        appStateListener = listener as (state: AppStateStatus) => void;
        return { remove: jest.fn() } as never;
      }),
    );
    jest.mocked(onSessionInvalidated).mockImplementation(listener => {
      invalidated = listener;
      return jest.fn();
    });
    jest.mocked(getValidAccessToken).mockResolvedValue('a-valid-token');
    jest.mocked(validateBackendSession).mockResolvedValue('valid');
    jest.mocked(bootstrapCurrentUser).mockResolvedValue({ status: 'ready', plan: 'Free', entitlement: null } as never);
  });

  afterEach(() => {
    spies.splice(0).forEach(spy => spy.mockRestore());
    jest.clearAllMocks();
  });

  it('cold start with a valid session: signed in, no dialog', async () => {
    const renderer = await renderSignedIn();
    expect(probe(renderer)).toBe('true:valid');
    expect(dialogs(renderer)).toHaveLength(0);
  });

  it('returning to the foreground with a valid session forces one refresh and shows nothing', async () => {
    const renderer = await renderSignedIn();
    await comeToForeground();
    expect(forcedRefreshCalls()).toBe(1);
    expect(dialogs(renderer)).toHaveLength(0);
    expect(probe(renderer)).toBe('true:valid');
  });

  it('is throttled: a second foreground within a minute does not ask Entra again', async () => {
    await renderSignedIn();
    await comeToForeground();
    now += 30_000;
    await comeToForeground();
    expect(forcedRefreshCalls()).toBe(1);
    now += 31_000;
    await comeToForeground();
    expect(forcedRefreshCalls()).toBe(2);
  });

  it('a network failure during the check keeps the session and shows nothing', async () => {
    const renderer = await renderSignedIn();
    jest.mocked(getValidAccessToken).mockRejectedValue(new EntraAuthError('Microsoft Entra session refresh failed.', { code: 'network_error' }));
    await comeToForeground();
    expect(probe(renderer)).toBe('true:valid');
    expect(dialogs(renderer)).toHaveLength(0);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it('a rejected refresh (the session manager reports it) shows the dialog with the agreed wording', async () => {
    const renderer = await renderSignedIn();
    jest.mocked(getValidAccessToken).mockImplementation(async () => {
      invalidated?.();
      throw new EntraAuthError('Microsoft Entra session refresh failed.', { code: 'invalid_grant' });
    });
    await comeToForeground();
    const [dialog] = dialogs(renderer);
    expect(dialog.props.title).toBe(i18n.t('auth.reauthRequiredTitle'));
    expect(dialog.props.message).toBe(i18n.t('auth.reauthRequiredMessage'));
    expect(dialog.props.confirmLabel).toBe(i18n.t('auth.reauthRequiredAction'));
    expect(dialog.props.dismissable).toBe(false);
    expect(dialog.props.onCancel).toBeUndefined();
  });

  it('several failures at once open ONE dialog', async () => {
    const renderer = await renderSignedIn();
    await act(async () => {
      invalidated?.();
      invalidated?.();
      invalidated?.();
    });
    expect(dialogs(renderer)).toHaveLength(1);
  });

  it('로그인하기 clears the local session and goes to the sign-in screen', async () => {
    const renderer = await renderSignedIn();
    await act(async () => {
      invalidated?.();
    });
    expect(probe(renderer)).toBe('true:valid');
    await act(async () => {
      dialogs(renderer)[0].props.onConfirm();
    });
    expect(clearSession).toHaveBeenCalled();
    expect(probe(renderer)).toBe('false:notChecked');
    expect(dialogs(renderer)).toHaveLength(0);
  });

  it('the Korean wording never claims the password changed', () => {
    const ko = i18n.getFixedT('ko');
    expect(ko('auth.reauthRequiredTitle')).toBe('다시 로그인이 필요합니다');
    expect(ko('auth.reauthRequiredMessage')).toBe('계정 정보가 변경되었거나 로그인 세션이 만료되어 다시 로그인이 필요합니다.');
    expect(ko('auth.reauthRequiredAction')).toBe('로그인하기');
    expect(ko('auth.reauthRequiredMessage')).not.toMatch(/비밀번호가 변경/);
  });
});

describe('createSessionValidator', () => {
  it('runs one check at a time and never throws', async () => {
    let calls = 0;
    let finish!: () => void;
    const validator = createSessionValidator({
      now: () => 0,
      validate: () => {
        calls += 1;
        return new Promise<void>((_, reject) => {
          finish = () => reject(new Error('offline'));
        });
      },
    });
    const a = validator.check(0);
    const b = validator.check(0);
    finish();
    await expect(Promise.all([a, b])).resolves.toEqual(['checked', 'checked']);
    expect(calls).toBe(1);
  });

  it('skips a check that comes sooner than the interval', async () => {
    let clock = 0;
    const validate = jest.fn().mockResolvedValue(undefined);
    const validator = createSessionValidator({ now: () => clock, validate });
    await validator.check(60_000);
    clock = 59_999;
    await expect(validator.check(60_000)).resolves.toBe('skipped');
    clock = 60_000;
    await expect(validator.check(60_000)).resolves.toBe('checked');
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
