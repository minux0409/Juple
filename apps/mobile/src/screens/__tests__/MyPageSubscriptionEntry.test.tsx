import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../api/accountApi', () => ({ deleteAccount: jest.fn() }));
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
// The entry flag is read when MyPage renders, so one mutable mock stands in for "production" vs "dogfood / Play Internal".
const mockApiConfig = { isSubscriptionTestEntryEnabled: false };
jest.mock('../../api/apiConfig', () => ({
  apiConfig: { baseUrl: 'https://api.test' },
  get isSubscriptionTestEntryEnabled() {
    return mockApiConfig.isSubscriptionTestEntryEnabled;
  },
}));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({
    signOut: jest.fn(), userEmail: null, plan: 'Free', entitlement: null, refreshEntitlement: jest.fn(),
    isInitializing: false, isSigningIn: false, isAuthenticated: true, error: null, backendAuthStatus: 'valid',
    userBootstrapStatus: 'ready', sessionRestoreStep: 'sessionRestore', signIn: jest.fn(), getValidAccessToken: jest.fn(), retryBootstrap: jest.fn(),
  });
});
afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyPageScreen />);
  });
  return renderer;
}
const entry = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'my-subscription-test' && typeof node.props.onPress === 'function');

describe('My Page internal subscription test entry', () => {
  it('is not exposed in the production release environment', async () => {
    mockApiConfig.isSubscriptionTestEntryEnabled = false;
    expect(entry(await renderScreen())).toHaveLength(0);
  });

  it('is exposed in dogfood / Play Internal (and local development) and opens the Subscription screen', async () => {
    mockApiConfig.isSubscriptionTestEntryEnabled = true;
    const renderer = await renderScreen();
    expect(entry(renderer)).toHaveLength(1);
    await act(async () => entry(renderer)[0].props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Subscription');
  });
});
