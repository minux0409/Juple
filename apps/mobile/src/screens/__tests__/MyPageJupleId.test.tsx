import ReactTestRenderer, { act } from 'react-test-renderer';
import { Share, Text } from 'react-native';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';
import { getReceivedCollectionInvitations } from '../../collections/api/collaborationApi';
import { getMyProfile, setMyDisplayName } from '../../api/profileApi';
import { ApiError } from '../../api/ApiError';
import { getFriendRequests } from '../../friends/api/friendsApi';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../api/accountApi', () => ({ deleteAccount: jest.fn() }));
jest.mock('../../settings/quickSaveOnSharePreference', () => ({
  loadQuickSaveOnSharePreference: jest.fn().mockResolvedValue(true),
  saveQuickSaveOnSharePreference: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getReceivedCollectionInvitations: jest.fn(),
}));
jest.mock('../../friends/api/friendsApi', () => ({
  getFriendRequests: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../api/profileApi', () => ({
  ...jest.requireActual('../../api/profileApi'),
  getMyProfile: jest.fn(),
  setMyDisplayName: jest.fn(),
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

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({ signOut: jest.fn(), userEmail: null } as never);
  jest.mocked(getMyProfile).mockResolvedValue({ displayName: null, jupleId: 'K7MP4Q8N' });
  jest.mocked(getReceivedCollectionInvitations).mockResolvedValue([
    { invitationId: 1 } as never,
    { invitationId: 2 } as never,
  ]);
});

afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyPageScreen />);
  });
  return renderer;
}

describe('MyPageScreen Juple ID and collaboration invitations', () => {
  it('shows my Juple ID (selectable, display-formatted) - never an internal id or email', async () => {
    const renderer = await renderScreen();

    const value = renderer.root.findAllByType(Text).find(node => node.props.children === 'K7MP-4Q8N');
    expect(value).toBeDefined();
    expect(value!.props.selectable).toBe(true);
  });

  it('copy/share hands the canonical ID to the OS share sheet (which offers Copy)', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'my-juple-id-copy' }).props.onPress();
    });

    expect(shareSpy).toHaveBeenCalledWith({ message: 'K7MP4Q8N' });
    shareSpy.mockRestore();
  });

  it('has no 초대 및 공동작업 entry - received collaboration invitations live under Categories > 공유 카테고리', async () => {
    const renderer = await renderScreen();

    expect(renderer.root.findAll(node => node.props.testID === 'my-collection-invitations')).toHaveLength(0);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === '초대 및 공동작업')).toBe(false);
    expect(getReceivedCollectionInvitations).not.toHaveBeenCalled();
    // The 친구 entry stays.
    expect(renderer.root.findByProps({ testID: 'my-friends' })).toBeTruthy();
  });
});

describe('MyPageScreen display name', () => {
  const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findByProps({ testID: 'my-display-name' }).findAllByType(Text).map(node => node.props.children);

  it('says it is not set (the Juple ID stands in) when there is none', async () => {
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain(i18n.t('myPage.nicknameNotSet'));
  });

  it('shows the name, and saves a new one through the profile API', async () => {
    jest.mocked(getMyProfile).mockResolvedValue({ displayName: '피카츄', jupleId: 'K7MP4Q8N' });
    jest.mocked(setMyDisplayName).mockResolvedValue({ displayName: '파이리', jupleId: 'K7MP4Q8N' });
    const renderer = await renderScreen();
    expect(texts(renderer)).toContain('피카츄');

    await act(async () => {
      renderer.root.findByProps({ testID: 'my-display-name-edit' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'display-name-input' }).props.onChangeText('  파이리 ');
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'display-name-save' }).props.onPress();
    });

    expect(setMyDisplayName).toHaveBeenCalledWith(expect.anything(), '  파이리 ');
    expect(texts(renderer)).toContain('파이리');
  });

  it('shows why an invalid name was refused, keeping the dialog open', async () => {
    jest.mocked(setMyDisplayName).mockRejectedValue(new ApiError('badRequest', 400));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'my-display-name-edit' }).props.onPress();
    });
    await act(async () => {
      renderer.root.findByProps({ testID: 'display-name-save' }).props.onPress();
    });

    expect(renderer.root.findAllByType(Text).some(node => node.props.children === i18n.t('myPage.displayNameInvalid'))).toBe(true);
    expect(renderer.root.findByProps({ testID: 'display-name-input' })).toBeTruthy();
  });
});

describe('MyPageScreen compact account card and friends entry', () => {
  it('shows the account, 닉네임 and Juple ID as rows of one card - with no long explanation', async () => {
    jest.mocked(getMyProfile).mockResolvedValue({ displayName: '쥬플', jupleId: '6WAUWBER' });
    const renderer = await renderScreen();

    const card = renderer.root.findByProps({ testID: 'my-account-card' });
    const shown = card.findAllByType(Text).map(node => node.props.children);
    expect(shown).toEqual(expect.arrayContaining(['닉네임', '쥬플', 'Juple ID', '6WAU-WBER']));
    expect(card.findByProps({ testID: 'my-display-name' })).toBeTruthy();
    expect(card.findByProps({ testID: 'my-juple-id' })).toBeTruthy();
    expect(renderer.root.findAllByType(Text).some(node => String(node.props.children).includes('공동작업하는 사람들에게'))).toBe(false);
  });

  it('has a 친구 entry with the number of received friend requests, separate from collaboration invitations', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([
      { requestId: 1, jupleId: 'AAAA2345', displayName: null, direction: 'incoming', createdAtUtc: '' },
      { requestId: 2, jupleId: 'BBBB2345', displayName: null, direction: 'outgoing', createdAtUtc: '' },
    ]);
    const renderer = await renderScreen();

    const entry = renderer.root.findByProps({ testID: 'my-friends' });
    expect(entry.findAllByType(Text).map(node => node.props.children)).toEqual(expect.arrayContaining(['친구', 1]));
    await act(async () => {
      entry.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Friends');
  });
});
