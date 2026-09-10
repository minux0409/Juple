import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert, Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';
import { deleteAccount } from '../../api/accountApi';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../api/accountApi', () => ({
  deleteAccount: jest.fn(),
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
    sessionRestoreStep: 'sessionRestore',
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

/** Finds the Text node with exactly this children text, then walks up to its nearest onPress-bearing ancestor. */
function findPressableContainingText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findByProps({ children: text });
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

/** MyPageScreen's single ConfirmDialog (a Modal) - used for the account-deletion confirm/cancel flow, distinct from sign-out's own native Alert. */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const dialog = renderer.root.findByType(Modal);
  return dialog.findAll(node => node.props.accessibilityLabel === label)[0];
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

describe('MyPageScreen account deletion', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('gates account deletion behind the shared ConfirmDialog, and only deletes after confirming', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });
    jest.mocked(deleteAccount).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    const deleteButton = findPressableContainingText(renderer, i18n.t('myPage.deleteAccount'));
    await act(async () => {
      deleteButton!.props.onPress();
    });

    expect(deleteAccount).not.toHaveBeenCalled();

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('common.delete')).props.onPress();
    });

    expect(deleteAccount).toHaveBeenCalledWith(expect.anything());
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not delete the account when the ConfirmDialog is cancelled', async () => {
    mockUseAuth({ userEmail: null });
    const renderer = await renderScreen();

    const deleteButton = findPressableContainingText(renderer, i18n.t('myPage.deleteAccount'));
    await act(async () => {
      deleteButton!.props.onPress();
    });

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('common.cancel')).props.onPress();
    });

    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
