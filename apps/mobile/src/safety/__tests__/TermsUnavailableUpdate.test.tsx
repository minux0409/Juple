import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { TermsUnavailable } from '../TermsUnavailable';
import { fetchAppUpdatePolicy } from '../../appUpdate/appUpdatePolicyApi';
import { openStore } from '../../appUpdate/openStore';

jest.mock('../../appUpdate/appUpdatePolicyApi', () => ({ fetchAppUpdatePolicy: jest.fn() }));
jest.mock('../../appUpdate/openStore', () => ({ openStore: jest.fn() }));
jest.mock('react-native-device-info', () => ({ getBundleId: () => 'com.juple.app' }));
jest.mock('../SubscriptionRights', () => ({ SubscriptionRights: () => null }));

const policy = { latestBuild: 42, minimumSupportedBuild: 24, storeUrl: 'https://play.google.com/store/apps/details?id=com.juple.app' };
beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => { jest.resetAllMocks(); });

async function mount() {
  const retry = jest.fn(), signOut = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TermsUnavailable onRetry={retry} onSignOut={signOut} />); });
  return { renderer, retry, signOut };
}
const button = (r: ReactTestRenderer.ReactTestRenderer) => r.root.find(node => node.props.testID === 'terms-unavailable-update' && typeof node.props.onPress === 'function');

it('opens only the existing store policy on explicit request; never retries acceptance or changes minimum support', async () => {
  jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy });
  jest.mocked(openStore).mockResolvedValue(true);
  const { renderer, retry, signOut } = await mount();
  expect(fetchAppUpdatePolicy).not.toHaveBeenCalled();
  await act(async () => { await button(renderer).props.onPress(); });
  expect(openStore).toHaveBeenCalledWith(policy, 'com.juple.app');
  expect(retry).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
  expect(policy.minimumSupportedBuild).toBe(24);
  await act(async () => renderer.unmount());
});

it('reports a store-open failure and allows retry without marking any consent', async () => {
  jest.mocked(fetchAppUpdatePolicy).mockResolvedValue({ ok: true, policy });
  jest.mocked(openStore).mockResolvedValue(false);
  const { renderer } = await mount();
  await act(async () => { await button(renderer).props.onPress(); });
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('appUpdate.openStoreFailed'))).toBe(true);
  expect(button(renderer).props.disabled).toBe(false);
  await act(async () => renderer.unmount());
});

it('does not open a store after the screen has gone away', async () => {
  let finish!: (value: { ok: true; policy: typeof policy }) => void;
  jest.mocked(fetchAppUpdatePolicy).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { renderer } = await mount();
  await act(async () => { button(renderer).props.onPress(); button(renderer).props.onPress(); });
  expect(fetchAppUpdatePolicy).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
  await act(async () => finish({ ok: true, policy }));
  expect(openStore).not.toHaveBeenCalled();
});
