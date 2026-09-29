import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { deleteAccount } from '../../api/accountApi';
import { ApiError } from '../../api/ApiError';
import { getMyProfile } from '../../api/profileApi';
import { useAuth } from '../../auth/AuthContext';
import { reauthenticateSameAccount } from '../../auth/reauthentication';
import { DeleteAccountScreen, normalizeTypedJupleId } from '../DeleteAccountScreen';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../auth/reauthentication', () => ({ reauthenticateSameAccount: jest.fn() }));
jest.mock('../../api/accountApi', () => ({ deleteAccount: jest.fn() }));
jest.mock('../../api/profileApi', () => ({
  ...jest.requireActual('../../api/profileApi'),
  getMyProfile: jest.fn(),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const signOut = jest.fn();

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({ signOut } as never);
  jest.mocked(getMyProfile).mockResolvedValue({ displayName: null, jupleId: 'K7MP4Q8N' });
});

afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<DeleteAccountScreen />);
  });
  return renderer;
}

const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findByProps({ testID });

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    byTestId(renderer, testID).props.onPress();
  });
}

async function reachConfirmStep() {
  jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated');
  const renderer = await renderScreen();
  await press(renderer, 'delete-account-continue');
  await press(renderer, 'delete-account-sign-in');
  return renderer;
}

async function type(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  await act(async () => {
    byTestId(renderer, 'delete-account-confirm-input').props.onChangeText(value);
  });
}

describe('DeleteAccountScreen', () => {
  it('starts with what will be deleted - and nothing can be deleted from this step', async () => {
    const renderer = await renderScreen();

    const warning = byTestId(renderer, 'delete-account-warning');
    const shown = warning.findAllByType(Text).map(node => node.props.children);
    for (const key of ['dataLinks', 'dataPhotos', 'dataCollections', 'dataSharing', 'dataFriends', 'dataNotifications', 'signInNote']) {
      expect(shown).toContain(i18n.t(`deleteAccount.${key}`));
    }
    expect(has(renderer, 'delete-account-final')).toBe(false);
    expect(reauthenticateSameAccount).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('continuing asks for a fresh sign-in before anything else', async () => {
    const renderer = await renderScreen();

    await press(renderer, 'delete-account-continue');

    expect(has(renderer, 'delete-account-reauthenticate')).toBe(true);
    expect(has(renderer, 'delete-account-final')).toBe(false);
    expect(reauthenticateSameAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['differentAccount', 'settings.collectionLockDifferentAccount'],
    ['incomplete', 'settings.collectionLockSignInCancelled'],
  ] as const)('a %s sign-in never reaches the final step', async (outcome, messageKey) => {
    jest.mocked(reauthenticateSameAccount).mockResolvedValue(outcome);
    const renderer = await renderScreen();
    await press(renderer, 'delete-account-continue');
    await press(renderer, 'delete-account-sign-in');

    expect(has(renderer, 'delete-account-final')).toBe(false);
    expect(byTestId(renderer, 'delete-account-notice').props.children).toBe(i18n.t(messageKey));
  });

  it('a cancelled sign-in (the sign-in page closed) never reaches the final step', async () => {
    jest.mocked(reauthenticateSameAccount).mockRejectedValue(new Error('cancelled'));
    const renderer = await renderScreen();
    await press(renderer, 'delete-account-continue');
    await press(renderer, 'delete-account-sign-in');

    expect(has(renderer, 'delete-account-final')).toBe(false);
  });

  it('after signing in, the delete button stays disabled until the exact Juple ID is typed', async () => {
    const renderer = await reachConfirmStep();

    expect(byTestId(renderer, 'delete-account-expected-id').props.children).toBe('K7MP-4Q8N');
    expect(byTestId(renderer, 'delete-account-final').props.disabled).toBe(true);

    await type(renderer, 'K7MP4Q8');
    expect(byTestId(renderer, 'delete-account-final').props.disabled).toBe(true);
    await press(renderer, 'delete-account-final');
    expect(deleteAccount).not.toHaveBeenCalled();

    await type(renderer, 'k7mp-4q8n');
    expect(byTestId(renderer, 'delete-account-final').props.disabled).toBe(false);
  });

  it('deletes once, then signs out', async () => {
    jest.mocked(deleteAccount).mockResolvedValue(undefined);
    const renderer = await reachConfirmStep();
    await type(renderer, 'K7MP-4Q8N');

    await act(async () => {
      const button = byTestId(renderer, 'delete-account-final');
      button.props.onPress();
      button.props.onPress();
    });

    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('when the server says the sign-in is too old, goes back to signing in - nothing was deleted', async () => {
    jest.mocked(deleteAccount).mockRejectedValue(new ApiError('forbidden', 403, 'recentAuthenticationRequired'));
    const renderer = await reachConfirmStep();
    await type(renderer, 'K7MP4Q8N');
    await press(renderer, 'delete-account-final');

    expect(signOut).not.toHaveBeenCalled();
    expect(has(renderer, 'delete-account-reauthenticate')).toBe(true);
    expect(byTestId(renderer, 'delete-account-notice').props.children).toBe(i18n.t('settings.collectionLockSignInExpired'));
  });

  it('any other failure keeps the user signed in with a message', async () => {
    jest.mocked(deleteAccount).mockRejectedValue(new ApiError('unavailable', 503));
    const renderer = await reachConfirmStep();
    await type(renderer, 'K7MP4Q8N');
    await press(renderer, 'delete-account-final');

    expect(signOut).not.toHaveBeenCalled();
    expect(byTestId(renderer, 'delete-account-notice').props.children).toBe(i18n.t('myPage.deleteAccountErrorFallback'));
  });

  it.each(['delete-account-warning', 'delete-account-reauthenticate', 'delete-account-confirm'])('cancel leaves from any step (%s)', async step => {
    jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated');
    const renderer = await renderScreen();
    if (step !== 'delete-account-warning') {
      await press(renderer, 'delete-account-continue');
    }
    if (step === 'delete-account-confirm') {
      await press(renderer, 'delete-account-sign-in');
    }
    expect(has(renderer, step)).toBe(true);

    await press(renderer, 'delete-account-cancel');

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});

describe('normalizeTypedJupleId', () => {
  it('ignores case, spaces, the display separator and a leading @', () => {
    expect(normalizeTypedJupleId(' @k7mp-4q8n ')).toBe('K7MP4Q8N');
    expect(normalizeTypedJupleId('K7MP 4Q8N')).toBe('K7MP4Q8N');
  });
});
