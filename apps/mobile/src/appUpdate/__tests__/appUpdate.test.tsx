import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Linking, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import i18n from '../../i18n';
import { parseEntitlement } from '../../auth/userBootstrapApi';
import { useAuth } from '../../auth/AuthContext';
import { AppUpdateGate, resetAppUpdatePromptMemory } from '../AppUpdateGate';
import { fetchAppUpdatePolicy } from '../appUpdatePolicyApi';
import { OPTIONAL_UPDATE_SNOOZE_MS, saveOptionalUpdateSnooze, type OptionalUpdateSnooze } from '../optionalUpdateSnooze';
import { openStore, storeTargets } from '../openStore';
import {
  evaluateAppUpdate,
  parseInstalledBuild,
  parseMobileVersionPolicy,
  platformPolicy,
  type MobileVersionPolicy,
} from '../versionPolicy';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../appUpdatePolicyApi', () => ({ fetchAppUpdatePolicy: jest.fn() }));
const mockSnooze: { value: OptionalUpdateSnooze | null } = { value: null };
jest.mock('../optionalUpdateSnooze', () => ({
  ...jest.requireActual('../optionalUpdateSnooze'),
  loadOptionalUpdateSnooze: jest.fn(async () => mockSnooze.value),
  saveOptionalUpdateSnooze: jest.fn(async (latestBuild: number, now: number) => {
    mockSnooze.value = { latestBuild, dismissedAt: now };
    return true;
  }),
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getBuildNumber: jest.fn(), getBundleId: jest.fn(() => 'com.juple.app') },
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const policy = (android: [number, number, string?], ios: [number, number, string?] = [0, 0]): MobileVersionPolicy => ({
  android: { latestBuild: android[0], minimumSupportedBuild: android[1], storeUrl: android[2] ?? null },
  ios: { latestBuild: ios[0], minimumSupportedBuild: ios[1], storeUrl: ios[2] ?? null },
});

describe('parseMobileVersionPolicy - fails open', () => {
  it('reads both platforms, trims the store url, and keeps only https urls', () => {
    expect(parseMobileVersionPolicy({
      android: { latestBuild: 12, minimumSupportedBuild: 9, storeUrl: null },
      ios: { latestBuild: 5, minimumSupportedBuild: 5, storeUrl: ' https://apps.apple.com/app/id1 ' },
    })).toEqual({
      android: { latestBuild: 12, minimumSupportedBuild: 9, storeUrl: null },
      ios: { latestBuild: 5, minimumSupportedBuild: 5, storeUrl: 'https://apps.apple.com/app/id1' },
    });
    expect(parseMobileVersionPolicy({ android: { latestBuild: 1, minimumSupportedBuild: 1, storeUrl: 'http://x' } })!.android!.storeUrl).toBeNull();
  });

  it.each([
    ['missing (an older backend)', undefined],
    ['null', null],
    ['not an object', 'x'],
    ['no platform understood', { android: { latestBuild: 'a' }, ios: 5 }],
  ])('%s -> no policy at all', (_name, raw) => {
    expect(parseMobileVersionPolicy(raw)).toBeNull();
  });

  it('a self-contradictory or malformed platform is dropped on its own; the other platform still counts', () => {
    const parsed = parseMobileVersionPolicy({
      android: { latestBuild: 3, minimumSupportedBuild: 8, storeUrl: null },
      ios: { latestBuild: 7, minimumSupportedBuild: 2, storeUrl: null },
    });
    expect(parsed).toEqual({ android: null, ios: { latestBuild: 7, minimumSupportedBuild: 2, storeUrl: null } });
    expect(parseMobileVersionPolicy({ android: { latestBuild: -1, minimumSupportedBuild: 0 }, ios: { latestBuild: 1.5, minimumSupportedBuild: 0 } })).toBeNull();
  });

  it('an entitlement-style parse is untouched by it (the bootstrap reader stays defensive)', () => {
    expect(parseEntitlement(undefined)).toBeNull();
  });
});

describe('evaluateAppUpdate - build numbers decide', () => {
  const android = policy([10, 6]).android;

  it.each([
    [10, 'current'],
    [11, 'current'],
    [9, 'optional'],
    [6, 'optional'],
    [5, 'required'],
    [0, 'required'],
  ])('installed build %s -> %s', (build, expected) => {
    expect(evaluateAppUpdate(android, build)).toBe(expected);
  });

  it('no policy, a 0/0 policy or an unreadable installed build never prompts or blocks', () => {
    expect(evaluateAppUpdate(null, 4)).toBe('current');
    expect(evaluateAppUpdate({ latestBuild: 0, minimumSupportedBuild: 0, storeUrl: null }, 4)).toBe('current');
    expect(evaluateAppUpdate(android, null)).toBe('current');
  });

  it('picks the policy of the CURRENT platform, and reads the installed build as a number', () => {
    const both = policy([10, 6], [3, 3]);
    expect(platformPolicy(both, 'android')!.latestBuild).toBe(10);
    expect(platformPolicy(both, 'ios')!.latestBuild).toBe(3);
    expect(platformPolicy(both, 'web')).toBeNull();
    expect(platformPolicy(null, 'android')).toBeNull();
    expect(parseInstalledBuild('4')).toBe(4);
    expect(parseInstalledBuild(' 12 ')).toBe(12);
    expect(parseInstalledBuild('4.1')).toBeNull();
    expect(parseInstalledBuild(undefined)).toBeNull();
  });
});

describe('store routing', () => {
  it('Android: the Play Store app first, the https Play page (or the server\'s url) as the fallback - package from the installed app', () => {
    expect(storeTargets('android', null, 'com.juple.app')).toEqual([
      'market://details?id=com.juple.app',
      'https://play.google.com/store/apps/details?id=com.juple.app',
    ]);
    expect(storeTargets('android', { latestBuild: 2, minimumSupportedBuild: 0, storeUrl: 'https://play.google.com/store/apps/details?id=x' }, 'com.juple.app')[1])
      .toBe('https://play.google.com/store/apps/details?id=x');
  });

  it('iOS: only the App Store url the server configured - there is no built-in one, so without it there is nothing to open', () => {
    expect(storeTargets('ios', { latestBuild: 2, minimumSupportedBuild: 0, storeUrl: 'https://apps.apple.com/app/id1' }, 'x')).toEqual(['https://apps.apple.com/app/id1']);
    expect(storeTargets('ios', null, 'x')).toEqual([]);
    expect(storeTargets('web', null, 'x')).toEqual([]);
  });

  it('opens the first target the system accepts, falls back when market:// is not handled, and reports a total failure', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no market')).mockResolvedValueOnce(undefined);
    expect(await openStore(null, 'com.juple.app', 'android')).toBe(true);
    expect(open.mock.calls.map(([url]) => url)).toEqual([
      'market://details?id=com.juple.app',
      'https://play.google.com/store/apps/details?id=com.juple.app',
    ]);

    open.mockReset().mockRejectedValue(new Error('nothing'));
    expect(await openStore(null, 'com.juple.app', 'android')).toBe(false);
    expect(await openStore(null, 'x', 'ios')).toBe(false);
    open.mockRestore();
  });
});

describe('AppUpdateGate', () => {
  type Renderer = ReactTestRenderer.ReactTestRenderer;
  const mounted: Renderer[] = [];
  const setAuth = (overrides: Record<string, unknown>) =>
    jest.mocked(useAuth).mockReturnValue({ isAuthenticated: true, userBootstrapStatus: 'ready', mobileVersionPolicy: null, ...overrides } as never);
  const setBuild = (build: string) => jest.mocked(DeviceInfo.getBuildNumber).mockReturnValue(build);
  const render = async () => {
    let renderer!: Renderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<AppUpdateGate />);
    });
    mounted.push(renderer);
    return renderer;
  };
  const dialog = (renderer: Renderer) => renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0];

  beforeEach(() => {
    resetAppUpdatePromptMemory();
    mockSnooze.value = null;
    // No sign-in-free answer unless a test provides one: the bootstrap policy is then what counts, exactly as before.
    jest.mocked(fetchAppUpdatePolicy).mockReset();
    jest.mocked(saveOptionalUpdateSnooze).mockClear();
    jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: false });
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  });
  afterEach(() => {
    act(() => mounted.splice(0).forEach(renderer => renderer.unmount()));
    jest.restoreAllMocks();
  });

  it('the latest build (or no policy, or not signed in yet) shows nothing', async () => {
    setBuild('10');
    setAuth({ mobileVersionPolicy: policy([10, 6]) });
    expect(dialog(await render())).toBeUndefined();

    setAuth({ mobileVersionPolicy: null });
    expect(dialog(await render())).toBeUndefined();

    setAuth({ mobileVersionPolicy: policy([99, 90]), isAuthenticated: false });
    expect(dialog(await render())).toBeUndefined();
    setAuth({ mobileVersionPolicy: policy([99, 90]), userBootstrapStatus: 'unavailable' });
    expect(dialog(await render())).toBeUndefined();
  });

  it('an older but supported build gets "업데이트가 있습니다" with 나중에 / 업데이트', async () => {
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });

    const shown = dialog(await render());

    expect(shown.props.title).toBe('업데이트가 있습니다');
    expect(shown.props.message).toBe('새로운 버전의 Juple을 사용할 수 있습니다.');
    expect(shown.props.cancelLabel).toBe('나중에');
    expect(shown.props.confirmLabel).toBe('업데이트');
  });

  it('나중에 dismisses it, and it does not come back in the same session (even for a fresh mount)', async () => {
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });
    const renderer = await render();

    await act(async () => dialog(renderer).props.onCancel());

    expect(dialog(renderer)).toBeUndefined();
    expect(dialog(await render())).toBeUndefined();
    // A NEWER latest build is a new question.
    setAuth({ mobileVersionPolicy: policy([6, 1]) });
    expect(dialog(await render())).toBeDefined();
  });

  it('업데이트 opens the Play Store on Android', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });
    const renderer = await render();

    await act(async () => dialog(renderer).props.onConfirm());

    expect(open).toHaveBeenCalledWith('market://details?id=com.juple.app');
    expect(dialog(renderer)).toBeUndefined();
  });

  it('below the minimum: "업데이트가 필요합니다" with ONLY 업데이트 - no way to dismiss it into the app', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setBuild('2');
    setAuth({ mobileVersionPolicy: policy([5, 3]) });
    const renderer = await render();

    const shown = dialog(renderer);
    expect(shown.props.title).toBe('업데이트가 필요합니다');
    expect(shown.props.message).toBe('Juple을 계속 사용하려면 최신 버전으로 업데이트해 주세요.');
    expect(shown.props.cancelLabel).toBeUndefined();
    expect(shown.props.onCancel).toBeUndefined();

    await act(async () => shown.props.onConfirm());
    expect(open).toHaveBeenCalled();
    // Still blocking after opening the store.
    expect(dialog(renderer)).toBeDefined();
  });

  it('uses the iOS policy and the configured App Store url on iOS; without one it says it cannot open the store', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setBuild('1');
    setAuth({ mobileVersionPolicy: policy([99, 90], [2, 2, 'https://apps.apple.com/app/id123']) });
    const renderer = await render();

    expect(dialog(renderer).props.title).toBe('업데이트가 필요합니다');
    await act(async () => dialog(renderer).props.onConfirm());
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/app/id123');

    open.mockClear();
    setAuth({ mobileVersionPolicy: policy([99, 90], [2, 2]) });
    const noUrl = await render();
    await act(async () => dialog(noUrl).props.onConfirm());
    expect(open).not.toHaveBeenCalled();
    expect(dialog(noUrl).props.message).toBe('스토어를 열지 못했어요. 잠시 후 다시 시도해 주세요.');
  });

  it('a build number it cannot read never blocks', async () => {
    jest.mocked(DeviceInfo.getBuildNumber).mockReturnValue('unknown');
    setAuth({ mobileVersionPolicy: policy([99, 90]) });

    expect(dialog(await render())).toBeUndefined();
  });

  describe('without signing in (the policy comes from the anonymous endpoint)', () => {
    const answer = (latest: number, minimum: number, storeUrl: string | null = null) =>
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: latest, minimumSupportedBuild: minimum, storeUrl } });
    const signedOut = () => setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });

    it('an optional update is offered on the sign-in screen, before any session exists', async () => {
      setBuild('24');
      answer(25, 24);
      signedOut();

      const shown = dialog(await render());

      expect(shown.props.title).toBe('업데이트가 있습니다');
      expect(shown.props.cancelLabel).toBe('나중에');
      expect(fetchAppUpdatePolicy).toHaveBeenCalledWith('android');
    });

    it('a required update blocks the signed-out app too, with no way to dismiss it', async () => {
      setBuild('24');
      answer(25, 25);
      signedOut();

      const shown = dialog(await render());

      expect(shown.props.title).toBe('업데이트가 필요합니다');
      expect(shown.props.cancelLabel).toBeUndefined();
      expect(shown.props.onCancel).toBeUndefined();
    });

    it('latest, newer-than-latest and disabled answers show nothing', async () => {
      setBuild('24');
      signedOut();
      answer(24, 23);
      expect(dialog(await render())).toBeUndefined();

      setBuild('30');
      expect(dialog(await render())).toBeUndefined();

      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: null });
      setBuild('1');
      expect(dialog(await render())).toBeUndefined();
    });

    it('fails open: an unreachable or unusable answer never nags or blocks', async () => {
      setBuild('1');
      signedOut();
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: false });
      expect(dialog(await render())).toBeUndefined();

      jest.mocked(fetchAppUpdatePolicy).mockRejectedValue(new Error('offline'));
      expect(dialog(await render())).toBeUndefined();
    });

    it('the bootstrap policy still applies after sign-in when the endpoint gave nothing', async () => {
      setBuild('4');
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: false });
      setAuth({ mobileVersionPolicy: policy([5, 1]) });

      expect(dialog(await render()).props.title).toBe('업데이트가 있습니다');
    });

    it('iOS never gets the Android policy: it asks for its own platform, and an empty answer shows nothing', async () => {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
      setBuild('1');
      signedOut();
      jest.mocked(fetchAppUpdatePolicy).mockImplementation(async platform =>
        platform === 'android' ? { ok: true, policy: { latestBuild: 99, minimumSupportedBuild: 99, storeUrl: null } } : { ok: true, policy: null });

      expect(dialog(await render())).toBeUndefined();
      expect(fetchAppUpdatePolicy).toHaveBeenCalledWith('ios');
      expect(fetchAppUpdatePolicy).not.toHaveBeenCalledWith('android');
    });
  });

  describe('optional update snooze (24 hours, per latest build)', () => {
    const answer = (latest: number, minimum: number) =>
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: latest, minimumSupportedBuild: minimum, storeUrl: null } });

    it('나중에 is remembered across launches for that build', async () => {
      setBuild('24');
      answer(25, 24);
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      const first = await render();

      await act(async () => dialog(first).props.onCancel());

      expect(mockSnooze.value).toMatchObject({ latestBuild: 25 });
      // A fresh process: the in-memory answers are gone, the stored one is not.
      resetAppUpdatePromptMemory();
      expect(dialog(await render())).toBeUndefined();
    });

    it('asks again after 24 hours, and at once for a newer latest build', async () => {
      setBuild('24');
      answer(25, 24);
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      const now = Date.now();

      mockSnooze.value = { latestBuild: 25, dismissedAt: now - OPTIONAL_UPDATE_SNOOZE_MS + 60_000 };
      expect(dialog(await render())).toBeUndefined();

      mockSnooze.value = { latestBuild: 25, dismissedAt: now - OPTIONAL_UPDATE_SNOOZE_MS - 60_000 };
      expect(dialog(await render())).toBeDefined();

      mockSnooze.value = { latestBuild: 24, dismissedAt: now };
      expect(dialog(await render())).toBeDefined();
    });

    it('a required update ignores any snooze', async () => {
      setBuild('24');
      answer(25, 25);
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      mockSnooze.value = { latestBuild: 25, dismissedAt: Date.now() };

      expect(dialog(await render()).props.title).toBe('업데이트가 필요합니다');
    });
  });

  describe('required update: only the button starts anything', () => {
    const requiredPolicy = () => {
      setBuild('23');
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 25, storeUrl: null } });
    };
    const modal = (renderer: Renderer) => renderer.root.findAll(node => typeof node.props.onRequestClose === 'function' && node.props.transparent === true)[0];
    const backdrop = (renderer: Renderer) =>
      renderer.root.findAll(node => node.props.accessibilityElementsHidden === true && typeof node.props.onPress === 'function')[0];

    it('the 업데이트 button opens the store', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      requiredPolicy();
      const renderer = await render();

      await act(async () => dialog(renderer).props.onConfirm());

      expect(open).toHaveBeenCalledWith('market://details?id=com.juple.app');
      expect(dialog(renderer)).toBeDefined();
    });

    it('Android Back does nothing: no store, and the dialog stays', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      open.mockClear();
      requiredPolicy();
      const renderer = await render();

      await act(async () => modal(renderer).props.onRequestClose());

      expect(open).not.toHaveBeenCalled();
      expect(dialog(renderer).props.title).toBe('업데이트가 필요합니다');
    });

    it('a tap outside the card does nothing: no store, and the dialog stays', async () => {
      const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      open.mockClear();
      requiredPolicy();
      const renderer = await render();

      await act(async () => backdrop(renderer).props.onPress());

      expect(open).not.toHaveBeenCalled();
      expect(dialog(renderer).props.title).toBe('업데이트가 필요합니다');
    });

    it('is a blocking modal over the app: the only action reachable in it is 업데이트', async () => {
      requiredPolicy();
      const renderer = await render();

      expect(modal(renderer).props.visible).toBe(true);
      expect(dialog(renderer).props.dismissable).toBe(false);
      expect(dialog(renderer).props.onCancel).toBeUndefined();
    });

    it('an optional update is still closed by Back like "나중에" (the shared dialog default is unchanged)', async () => {
      setBuild('24');
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 24, storeUrl: null } });
      const renderer = await render();
      expect(dialog(renderer).props.dismissable).toBeUndefined();

      await act(async () => modal(renderer).props.onRequestClose());

      expect(dialog(renderer)).toBeUndefined();
      expect(mockSnooze.value).toMatchObject({ latestBuild: 25 });
    });
  });

  describe('"나중에" is persisted before the dialog goes away', () => {
    const optional = () => {
      setBuild('24');
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 24, storeUrl: null } });
    };

    it('the dialog stays until the write has completed, then closes - and what is stored is what was shown', async () => {
      optional();
      let finishWrite!: (ok: boolean) => void;
      jest.mocked(saveOptionalUpdateSnooze).mockImplementationOnce(
        (latestBuild: number, now: number) => new Promise<boolean>(resolve => {
          finishWrite = ok => {
            mockSnooze.value = { latestBuild, dismissedAt: now };
            resolve(ok);
          };
        }),
      );
      const renderer = await render();

      await act(async () => dialog(renderer).props.onCancel());
      // The write is still pending: not stored yet, and the person is not told "done".
      expect(mockSnooze.value).toBeNull();
      expect(dialog(renderer)).toBeDefined();

      await act(async () => finishWrite(true));

      expect(mockSnooze.value).toMatchObject({ latestBuild: 25 });
      expect(dialog(renderer)).toBeUndefined();
    });

    it('a second tap while the write is pending is ignored: one answer, one write', async () => {
      optional();
      let finishWrite!: (ok: boolean) => void;
      jest.mocked(saveOptionalUpdateSnooze).mockImplementationOnce(() => new Promise<boolean>(resolve => { finishWrite = resolve; }));
      const renderer = await render();

      await act(async () => {
        dialog(renderer).props.onCancel();
        dialog(renderer).props.onCancel();
      });
      await act(async () => finishWrite(true));

      expect(saveOptionalUpdateSnooze).toHaveBeenCalledTimes(1);
    });

    it('survives a restart: a fresh process with the stored answer shows nothing for the same latest build', async () => {
      optional();
      const first = await render();
      await act(async () => dialog(first).props.onCancel());
      expect(mockSnooze.value).toMatchObject({ latestBuild: 25 });

      resetAppUpdatePromptMemory();
      expect(dialog(await render())).toBeUndefined();
    });

    it('a newer latest build asks again at once, whatever was stored', async () => {
      optional();
      mockSnooze.value = { latestBuild: 24, dismissedAt: Date.now() };

      expect(dialog(await render())).toBeDefined();
    });

    it('a failed write never blocks the app: the dialog closes and is not asked again this session', async () => {
      optional();
      jest.mocked(saveOptionalUpdateSnooze).mockResolvedValueOnce(false);
      const renderer = await render();

      await act(async () => dialog(renderer).props.onCancel());

      expect(dialog(renderer)).toBeUndefined();
      // Same process (the in-memory answers survive), nothing was persisted: still not asked again.
      mockSnooze.value = null;
      expect(dialog(await render())).toBeUndefined();
    });

    it('a write that throws is handled the same way (the gate never leaves the dialog stuck)', async () => {
      optional();
      jest.mocked(saveOptionalUpdateSnooze).mockRejectedValueOnce(new Error('disk'));
      const renderer = await render();

      await act(async () => dialog(renderer).props.onCancel());

      expect(dialog(renderer)).toBeUndefined();
    });

    it('never applies to a required update, however fresh the stored answer', async () => {
      setBuild('24');
      setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
      jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 25, storeUrl: null } });
      mockSnooze.value = { latestBuild: 25, dismissedAt: Date.now() };

      expect(dialog(await render()).props.title).toBe('업데이트가 필요합니다');
    });
  });

  describe('coming back to the foreground', () => {
    it('re-reads the policy, so a policy change (or a finished update) is seen without restarting', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-12T00:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      try {
        let listener: ((state: string) => void) | undefined;
        jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
          listener = handler;
          return { remove: jest.fn() };
        }) as never);
        setBuild('23');
        setAuth({ isAuthenticated: false, userBootstrapStatus: 'idle', mobileVersionPolicy: null });
        jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 25, storeUrl: null } });
        const renderer = await render();
        expect(dialog(renderer).props.title).toBe('업데이트가 필요합니다');
        expect(fetchAppUpdatePolicy).toHaveBeenCalledTimes(1);

        // Returning at once does not hammer the server...
        await act(async () => listener?.('active'));
        expect(fetchAppUpdatePolicy).toHaveBeenCalledTimes(1);

        // ...but a later return asks again, and a lifted requirement is honoured.
        jest.setSystemTime(new Date('2026-10-12T00:05:00Z'));
        jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy: { latestBuild: 25, minimumSupportedBuild: 23, storeUrl: null } });
        await act(async () => listener?.('active'));

        expect(fetchAppUpdatePolicy).toHaveBeenCalledTimes(2);
        expect(dialog(renderer).props.title).toBe('업데이트가 있습니다');
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
