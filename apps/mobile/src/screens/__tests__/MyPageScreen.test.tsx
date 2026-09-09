import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../settings/quickSaveOnSharePreference', () => ({
  loadQuickSaveOnSharePreference: jest.fn().mockResolvedValue(true),
  saveQuickSaveOnSharePreference: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      return callback();
    }, [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

function mockUseAuth(overrides: { signOut?: jest.Mock; userEmail?: string | null }) {
  jest.mocked(useAuth).mockReturnValue({
    signOut: overrides.signOut ?? jest.fn(),
    userEmail: overrides.userEmail ?? null,
    isInitializing: false,
    isSigningIn: false,
    isAuthenticated: true,
    error: null,
    backendAuthStatus: 'valid',
    userBootstrapStatus: 'ready',
    signIn: jest.fn(),
    getValidAccessToken: jest.fn(),
    retryBootstrap: jest.fn(),
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyPageScreen />);
  });
  return renderer;
}

function findTextValues(renderer: ReactTestRenderer.ReactTestRenderer): unknown[] {
  return renderer.root.findAllByType(Text).map(node => node.props.children);
}

describe('MyPageScreen account section', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders the user's email when available", async () => {
    mockUseAuth({ userEmail: 'user@example.com' });
    const renderer = await renderScreen();

    expect(findTextValues(renderer)).toContain('user@example.com');
  });

  it('falls back to the generic signed-in message when no email is available (never a placeholder)', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    expect(findTextValues(renderer)).toContain(i18n.t('myPage.loggedInAs'));
  });
});

describe('MyPageScreen sign-out', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates the actual sign-out behind a confirm dialog', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });
    const alertSpy = jest.spyOn(Alert, 'alert');

    const renderer = await renderScreen();

    // Matches by the presence of an onPress prop rather than findAllByType(Pressable) - RN's
    // Pressable export and the JSX element's resolved type are not always the exact same
    // reference under this app's Jest/Babel setup, so type-based matching silently returns nothing.
    const logoutButton = renderer.root
      .findAll(node => typeof node.props.onPress === 'function')
      .find(node => node.props.accessibilityLabel === i18n.t('auth.logout'));
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton!.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(signOut).not.toHaveBeenCalled();

    const alertButtons = alertSpy.mock.calls[0][2] as ReadonlyArray<{
      style?: string;
      onPress?: () => void;
    }>;
    const destructiveButton = alertButtons.find(button => button.style === 'destructive');
    expect(destructiveButton).toBeDefined();

    await act(async () => {
      destructiveButton!.onPress!();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
