import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
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

/**
 * MyPageScreen renders two ConfirmDialogs (sign-out, account-deletion), each a Modal always
 * present in the tree with its own `visible` prop - only the currently-open one is queried, so a
 * shared button label (both dialogs' Cancel is 취소) still resolves unambiguously.
 */
function getConfirmDialogButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const openDialog = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
  return openDialog.findAll(node => node.props.accessibilityLabel === label)[0];
}

function isInsideModal(node: ReactTestRenderer.ReactTestInstance): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === Modal) {
      return true;
    }
  }
  return false;
}

/** The header's sign-out icon button shares its accessibilityLabel (로그아웃) with the sign-out ConfirmDialog's confirm button - excluding anything inside a Modal disambiguates the two. */
function findHeaderLogoutButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAll(
      node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === i18n.t('auth.logout'),
    )
    .find(node => !isInsideModal(node));
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

  it('gates the actual sign-out behind the shared ConfirmDialog', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });

    const renderer = await renderScreen();

    const logoutButton = findHeaderLogoutButton(renderer);
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton!.props.onPress();
    });

    expect(signOut).not.toHaveBeenCalled();

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('auth.logout')).props.onPress();
    });

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign out when the ConfirmDialog is cancelled', async () => {
    const signOut = jest.fn();
    mockUseAuth({ signOut, userEmail: null });
    const renderer = await renderScreen();

    const logoutButton = findHeaderLogoutButton(renderer);

    await act(async () => {
      logoutButton!.props.onPress();
    });

    await act(async () => {
      getConfirmDialogButton(renderer, i18n.t('common.cancel')).props.onPress();
    });

    expect(signOut).not.toHaveBeenCalled();
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
