import { Platform } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';
import { getGoogleCatalog } from '../../billing/billingApi';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../api/accountApi', () => ({ deleteAccount: jest.fn() }));
jest.mock('../../billing/billingApi', () => ({ getGoogleCatalog: jest.fn() }));
jest.mock('../../settings/quickSaveOnSharePreference', () => ({
  loadQuickSaveOnSharePreference: jest.fn().mockResolvedValue(true),
  saveQuickSaveOnSharePreference: jest.fn().mockResolvedValue(undefined),
}));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const enabledCatalog = { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'opaque' };
const disabledCatalog = { enabled: false, productId: null, basePlanId: null, obfuscatedAccountId: null };

function mockAuth(entitlement: unknown) {
  jest.mocked(useAuth).mockReturnValue({
    signOut: jest.fn(), userEmail: null, plan: 'Free', entitlement,
    storeSubscription: null, refreshEntitlement: jest.fn(),
    isInitializing: false, isSigningIn: false, isAuthenticated: true, error: null, backendAuthStatus: 'valid',
    userBootstrapStatus: 'ready', sessionRestoreStep: 'sessionRestore', signIn: jest.fn(), getValidAccessToken: jest.fn(), retryBootstrap: jest.fn(),
  } as never);
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  mockAuth(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyPageScreen />);
  });
  return renderer;
}
const entry = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'my-subscription' && typeof node.props.onPress === 'function');

describe('My Page Subscription entry (a normal feature, not a test entry)', () => {
  it('is shown on Android when the Backend catalog has Google billing enabled, even while the subscription program is OFF', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockResolvedValue(enabledCatalog);
    // programEnabled:false is exactly the Production state today - the entry must not depend on it.
    mockAuth({ programEnabled: false, status: null, canWrite: true });

    const renderer = await renderScreen();

    expect(entry(renderer)).toHaveLength(1);
    await act(async () => entry(renderer)[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Subscription');
  });

  it('is labelled with the plain "Subscription" title - no internal-test wording', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockResolvedValue(enabledCatalog);

    const renderer = await renderScreen();
    const texts = entry(renderer)[0].findAll(node => typeof node.props.children === 'string').map(node => node.props.children as string);

    expect(texts).toContain('Subscription');
    expect(texts.join(' ')).not.toMatch(/internal|test/i);
  });

  it('is hidden on Android when the catalog is disabled (nothing can be bought)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockResolvedValue(disabledCatalog);

    expect(entry(await renderScreen())).toHaveLength(0);
  });

  it('is hidden - and the catalog is not even requested - on iOS, which has no store implementation yet', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(getGoogleCatalog).mockResolvedValue(enabledCatalog);

    expect(entry(await renderScreen())).toHaveLength(0);
    expect(getGoogleCatalog).not.toHaveBeenCalled();
  });

  it('is not invented when the catalog request fails', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.mocked(getGoogleCatalog).mockRejectedValue(new Error('offline'));

    expect(entry(await renderScreen())).toHaveLength(0);
  });
});
