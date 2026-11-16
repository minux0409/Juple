import { Platform, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { useAuth } from '../../auth/AuthContext';
import { getAppleCatalog, getGoogleCatalog } from '../../billing/billingApi';
import { MembershipScreen } from '../MembershipScreen';
import { SubscriptionScreen } from '../SubscriptionScreen';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../billing/billingApi', () => ({ getGoogleCatalog: jest.fn(), getAppleCatalog: jest.fn() }));
jest.mock('../SubscriptionScreen', () => ({ SubscriptionScreen: () => null }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const enabledCatalog = { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'opaque' };

const refreshEntitlement = jest.fn().mockResolvedValue(undefined);

function mockAuth(entitlement: unknown, storeSubscription: unknown = null) {
  jest.mocked(useAuth).mockReturnValue({ entitlement, storeSubscription, refreshEntitlement } as never);
}

async function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MembershipScreen />);
  });
  return renderer;
}
const allText = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' | ');

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('MembershipScreen', () => {
  it('Android with the store catalog: it is the real subscription screen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockResolvedValue(enabledCatalog);
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    const renderer = await render();
    expect(renderer.root.findAllByType(SubscriptionScreen)).toHaveLength(1);
  });

  it('while the Android catalog is being read it shows a spinner - never the status page first', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    let release!: (value: typeof enabledCatalog) => void;
    jest.mocked(getGoogleCatalog).mockReturnValue(new Promise(resolve => { release = resolve; }));
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    const renderer = await render();
    expect(renderer.root.findAllByProps({ testID: 'membership-loading' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: 'membership-cannot-subscribe' })).toHaveLength(0);
    await act(async () => release(enabledCatalog));
    expect(renderer.root.findAllByType(SubscriptionScreen)).toHaveLength(1);
  });

  it('iOS with the App Store catalog: it is the real subscription screen, and only the App Store catalog is read', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: true, productIds: ['m', 'y'], appAccountToken: 'uuid' });
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    const renderer = await render();
    expect(renderer.root.findAllByType(SubscriptionScreen)).toHaveLength(1);
    expect(getAppleCatalog).toHaveBeenCalled();
    expect(getGoogleCatalog).not.toHaveBeenCalled();
  });

  it('iOS while the App Store billing is not enabled: a read-only status page - the free period end from the server, no purchase, no price', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    const renderer = await render();
    const text = allText(renderer);
    expect(text).toContain('You are in your free period until');
    expect(text).toContain("Subscribing from this device isn't available yet.");
    expect(text).toContain('same on Android, iOS and the web');
    expect(text).not.toMatch(/\$|₩|€|price|subscribe now/i);
    expect(getGoogleCatalog).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(SubscriptionScreen)).toHaveLength(0);
  });

  it('a store that is not configured (catalog disabled) is the same status page', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockResolvedValue({ ...enabledCatalog, enabled: false });
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    const renderer = await render();
    expect(allText(renderer)).toContain("Subscribing from this device isn't available yet.");
  });

  it('an ended membership says so and that saved data stays readable and is not deleted', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth({ programEnabled: true, status: 'expired', trialEndsAtUtc: null, canWrite: false }, null);
    const text = allText(await render());
    expect(text).toContain('Your membership has ended.');
    expect(text).toContain("We don't delete your saved links or collections.");
  });

  it('opening the screen re-reads the status from the server (days left and status are never stale device values)', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth({ programEnabled: true, status: 'trial', trialEndsAtUtc: '2026-12-01T00:00:00Z', canWrite: true });
    await render();
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);
  });

  it('the status page also shows "Juple Membership", the status badge and the free-month card from the server values', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth({
      programEnabled: true, status: 'trial', trialStartedAtUtc: '2026-11-04T00:00:00Z', trialEndsAtUtc: '2026-12-04T00:00:00Z',
      verifiedAtUtc: '2026-11-16T00:00:00Z', canWrite: true,
    });
    const renderer = await render();
    const text = allText(renderer);
    expect(text).toContain(i18n.t('membership.heroTitle'));
    expect(text).toContain(i18n.t('membership.trialCard.daysLeft', { count: 18 }));
    expect(text).toContain('D-18');
    expect(renderer.root.findAllByProps({ testID: 'membership-badge-trial' }).length).toBeGreaterThan(0);
    // The card is the status; the sentence repeating the end date is not shown twice.
    expect(renderer.root.findAllByProps({ testID: 'membership-status' })).toHaveLength(0);
    expect(text).not.toMatch(/\$|₩|€|price|subscribe now/i);
  });

  it('a free period that ended (never subscribed) is badged "free period ended"', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth({ programEnabled: true, status: 'expired', trialEndsAtUtc: '2026-11-01T00:00:00Z', accessFrozenAtUtc: '2026-11-01T00:00:00Z', canWrite: false }, null);
    const renderer = await render();
    expect(renderer.root.findAllByProps({ testID: 'membership-badge-trialEnded' }).length).toBeGreaterThan(0);
  });

  it('an active subscription (reported by the server) is shown as active', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getAppleCatalog).mockResolvedValue({ enabled: false, productIds: [], appAccountToken: null });
    mockAuth(
      { programEnabled: true, status: 'active', trialEndsAtUtc: null, canWrite: true },
      { state: 'active', autoRenewing: true, startedAtUtc: '2026-11-01T00:00:00Z', currentPeriodEndsAtUtc: '2026-12-01T00:00:00Z', endedState: null, endedAtUtc: null },
    );
    expect(allText(await render())).toContain('Your membership is active.');
  });
});
