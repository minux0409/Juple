import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { MyPageScreen } from '../MyPageScreen';
import { useAuth } from '../../auth/AuthContext';
import { getReceivedCollectionInvitations } from '../../collections/api/collaborationApi';
import { getMyProfile } from '../../api/profileApi';
import { getFriendRequests } from '../../friends/api/friendsApi';
import { resetProfileImageCacheForTests } from '../../profile/profileImageCache';
import { emitSocialPushEvent } from '../../push/pushEvents';

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
  resetProfileImageCacheForTests();
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

const headerTexts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findByProps({ testID: 'my-profile-header' }).findAllByType(Text).map(node => node.props.children);

describe('MyPageScreen profile header', () => {
  it('shows my Juple ID as @ID (selectable, display-formatted) - never an internal id or email', async () => {
    const renderer = await renderScreen();

    const value = renderer.root.findByProps({ testID: 'my-juple-id' });
    expect(value.props.children).toBe('@K7MP-4Q8N');
    expect(value.props.selectable).toBe(true);
  });

  it('says the nickname is not set, with a fallback avatar, when there is neither', async () => {
    const renderer = await renderScreen();

    expect(headerTexts(renderer)).toContain(i18n.t('myPage.nicknameNotSet'));
    expect(renderer.root.findByProps({ testID: 'my-profile-header' }).findByProps({ testID: 'user-avatar-fallback' })).toBeTruthy();
  });

  it('shows the nickname and the profile photo', async () => {
    jest.mocked(getMyProfile).mockResolvedValue({
      displayName: '피카츄',
      jupleId: 'K7MP4Q8N',
      profileImageUrl: 'https://blob/me?sig=1',
      profileImageVersion: 'v1',
    });
    const renderer = await renderScreen();

    expect(headerTexts(renderer)).toEqual(expect.arrayContaining(['피카츄', '@K7MP-4Q8N']));
    const header = renderer.root.findByProps({ testID: 'my-profile-header' });
    expect(header.findByType(Image).props.source.uri).toBe('https://blob/me?sig=1');
  });

  it('프로필 편집 opens the Profile Edit screen', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'my-profile-edit' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('ProfileEdit');
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

describe('MyPageScreen friends entry', () => {
  it('has a 친구 entry with the number of received friend requests, separate from collaboration invitations', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([
      { requestId: 1, jupleId: 'AAAA2345', displayName: null, direction: 'incoming', createdAtUtc: '' },
      { requestId: 2, jupleId: 'BBBB2345', displayName: null, direction: 'outgoing', createdAtUtc: '' },
    ]);
    const renderer = await renderScreen();

    const entry = renderer.root.findByProps({ testID: 'my-friends' });
    expect(entry.findAllByType(Text).map(node => node.props.children)).toEqual(expect.arrayContaining(['친구', '1']));
    await act(async () => {
      entry.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Friends');
  });

  it('the 친구 badge follows a friend request Push while My Page is open', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([]);
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => node.props.testID === 'my-friends-badge')).toHaveLength(0);

    jest.mocked(getFriendRequests).mockResolvedValue([
      { requestId: 5, jupleId: 'CCCC2345', displayName: null, direction: 'incoming', createdAtUtc: '' },
    ]);
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
    });

    expect(renderer.root.findByProps({ testID: 'my-friends-badge' }).props.children).toBe('1');
  });
});
