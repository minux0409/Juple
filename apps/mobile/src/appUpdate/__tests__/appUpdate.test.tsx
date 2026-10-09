import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import i18n from '../../i18n';
import { parseEntitlement } from '../../auth/userBootstrapApi';
import { useAuth } from '../../auth/AuthContext';
import { AppUpdateGate, resetAppUpdatePromptMemory } from '../AppUpdateGate';
import { openStore, storeTargets } from '../openStore';
import {
  evaluateAppUpdate,
  parseInstalledBuild,
  parseMobileVersionPolicy,
  platformPolicy,
  type MobileVersionPolicy,
} from '../versionPolicy';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
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
  const render = () => {
    let renderer!: Renderer;
    act(() => {
      renderer = ReactTestRenderer.create(<AppUpdateGate />);
    });
    mounted.push(renderer);
    return renderer;
  };
  const dialog = (renderer: Renderer) => renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0];

  beforeEach(() => {
    resetAppUpdatePromptMemory();
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  });
  afterEach(() => {
    act(() => mounted.splice(0).forEach(renderer => renderer.unmount()));
    jest.restoreAllMocks();
  });

  it('the latest build (or no policy, or not signed in yet) shows nothing', () => {
    setBuild('10');
    setAuth({ mobileVersionPolicy: policy([10, 6]) });
    expect(dialog(render())).toBeUndefined();

    setAuth({ mobileVersionPolicy: null });
    expect(dialog(render())).toBeUndefined();

    setAuth({ mobileVersionPolicy: policy([99, 90]), isAuthenticated: false });
    expect(dialog(render())).toBeUndefined();
    setAuth({ mobileVersionPolicy: policy([99, 90]), userBootstrapStatus: 'unavailable' });
    expect(dialog(render())).toBeUndefined();
  });

  it('an older but supported build gets "업데이트가 있습니다" with 나중에 / 업데이트', () => {
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });

    const shown = dialog(render());

    expect(shown.props.title).toBe('업데이트가 있습니다');
    expect(shown.props.message).toBe('새로운 버전의 Juple을 사용할 수 있습니다.');
    expect(shown.props.cancelLabel).toBe('나중에');
    expect(shown.props.confirmLabel).toBe('업데이트');
  });

  it('나중에 dismisses it, and it does not come back in the same session (even for a fresh mount)', () => {
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });
    const renderer = render();

    act(() => dialog(renderer).props.onCancel());

    expect(dialog(renderer)).toBeUndefined();
    expect(dialog(render())).toBeUndefined();
    // A NEWER latest build is a new question.
    setAuth({ mobileVersionPolicy: policy([6, 1]) });
    expect(dialog(render())).toBeDefined();
  });

  it('업데이트 opens the Play Store on Android', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setBuild('4');
    setAuth({ mobileVersionPolicy: policy([5, 1]) });
    const renderer = render();

    await act(async () => dialog(renderer).props.onConfirm());

    expect(open).toHaveBeenCalledWith('market://details?id=com.juple.app');
    expect(dialog(renderer)).toBeUndefined();
  });

  it('below the minimum: "업데이트가 필요합니다" with ONLY 업데이트 - no way to dismiss it into the app', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setBuild('2');
    setAuth({ mobileVersionPolicy: policy([5, 3]) });
    const renderer = render();

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
    const renderer = render();

    expect(dialog(renderer).props.title).toBe('업데이트가 필요합니다');
    await act(async () => dialog(renderer).props.onConfirm());
    expect(open).toHaveBeenCalledWith('https://apps.apple.com/app/id123');

    open.mockClear();
    setAuth({ mobileVersionPolicy: policy([99, 90], [2, 2]) });
    const noUrl = render();
    await act(async () => dialog(noUrl).props.onConfirm());
    expect(open).not.toHaveBeenCalled();
    expect(dialog(noUrl).props.message).toBe('스토어를 열지 못했어요. 잠시 후 다시 시도해 주세요.');
  });

  it('a build number it cannot read never blocks', () => {
    jest.mocked(DeviceInfo.getBuildNumber).mockReturnValue('unknown');
    setAuth({ mobileVersionPolicy: policy([99, 90]) });

    expect(dialog(render())).toBeUndefined();
  });
});
