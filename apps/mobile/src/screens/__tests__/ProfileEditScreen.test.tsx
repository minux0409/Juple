import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { getMyProfile, removeMyProfileImage, setMyDisplayName, setMyProfileImage } from '../../api/profileApi';
import { pickCollectionIconImage } from '../../collections/collectionIconImage';
import { resetProfileImageCacheForTests } from '../../profile/profileImageCache';
import { ProfileEditScreen } from '../ProfileEditScreen';

jest.mock('../../api/profileApi', () => ({
  ...jest.requireActual('../../api/profileApi'),
  getMyProfile: jest.fn(),
  setMyDisplayName: jest.fn(),
  setMyProfileImage: jest.fn(),
  removeMyProfileImage: jest.fn(),
}));
jest.mock('../../collections/collectionIconImage', () => ({
  pickCollectionIconImage: jest.fn(),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const PROFILE = {
  displayName: '피카츄',
  jupleId: 'K7MP4Q8N',
  profileImageUrl: 'https://blob/me?sig=1',
  profileImageVersion: 'v1',
  signInMethod: 'email',
};

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  resetProfileImageCacheForTests();
  jest.mocked(getMyProfile).mockResolvedValue(PROFILE);
});

afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ProfileEditScreen />);
  });
  return renderer;
}

const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findByProps({ testID });
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    byTestId(renderer, testID).props.onPress();
  });
}

async function typeNickname(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  await act(async () => {
    byTestId(renderer, 'profile-nickname-input').props.onChangeText(value);
  });
}

describe('ProfileEditScreen', () => {
  it('shows the current nickname, the photo and the Juple ID read-only', async () => {
    const renderer = await renderScreen();

    expect(byTestId(renderer, 'profile-nickname-input').props.value).toBe('피카츄');
    expect(renderer.root.findAllByProps({ testID: 'user-avatar-image' }).length).toBeGreaterThan(0);
    const jupleId = byTestId(renderer, 'profile-juple-id').findByType(Text);
    expect(jupleId.props.children).toBe('@K7MP-4Q8N');
    // Read-only: shown as text, never an editable input.
    expect(renderer.root.findAll(node => node.props.testID === 'profile-juple-id-input')).toHaveLength(0);
  });

  it('saves a changed nickname, then returns', async () => {
    jest.mocked(setMyDisplayName).mockResolvedValue({ ...PROFILE, displayName: '파이리' });
    const renderer = await renderScreen();

    await typeNickname(renderer, '파이리');
    await press(renderer, 'profile-save');

    expect(setMyDisplayName).toHaveBeenCalledWith(expect.anything(), '파이리');
    expect(setMyProfileImage).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['nicknameReserved', 'profile.nicknameReserved'],
    ['nicknameProhibited', 'profile.nicknameProhibited'],
    ['nicknameInvalidCharacters', 'profile.nicknameInvalidCharacters'],
    ['nicknameTooLong', 'profile.nicknameTooLong'],
    [undefined, 'profile.nicknameInvalid'],
  ])('maps the server code %s to its own message and stays on the screen', async (code, key) => {
    jest.mocked(setMyDisplayName).mockRejectedValue(new ApiError('badRequest', 400, code));
    const renderer = await renderScreen();

    await typeNickname(renderer, 'Juple');
    await press(renderer, 'profile-save');

    expect(byTestId(renderer, 'profile-error').props.children).toBe(i18n.t(key, { max: 30 }));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('uploads a newly picked photo on save, previewing the picked file first', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///new.jpg', type: 'image/jpeg' } });
    jest.mocked(setMyProfileImage).mockResolvedValue({ ...PROFILE, profileImageUrl: 'https://blob/new?sig=1', profileImageVersion: 'v2' });
    const renderer = await renderScreen();

    await press(renderer, 'profile-photo-change');
    expect(byTestId(renderer, 'user-avatar-image').findByType(Image).props.source.uri).toBe('file:///new.jpg');
    expect(setMyProfileImage).not.toHaveBeenCalled();

    await press(renderer, 'profile-save');
    expect(setMyProfileImage).toHaveBeenCalledWith(expect.anything(), { uri: 'file:///new.jpg', type: 'image/jpeg' });
    expect(setMyDisplayName).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('removes the photo on save, falling back to the initial in the preview', async () => {
    jest.mocked(removeMyProfileImage).mockResolvedValue({ ...PROFILE, profileImageUrl: null, profileImageVersion: null });
    const renderer = await renderScreen();

    await press(renderer, 'profile-photo-remove');
    expect(renderer.root.findAll(node => node.props.testID === 'user-avatar-image')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'profile-photo-remove')).toHaveLength(0);

    await press(renderer, 'profile-save');
    expect(removeMyProfileImage).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('a rejected photo keeps the user on the screen with a message (the nickname is already saved)', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///big.jpg' } });
    jest.mocked(setMyDisplayName).mockResolvedValue({ ...PROFILE, displayName: '파이리' });
    jest.mocked(setMyProfileImage).mockRejectedValue(new ApiError('badRequest', 400));
    const renderer = await renderScreen();

    await typeNickname(renderer, '파이리');
    await press(renderer, 'profile-photo-change');
    await press(renderer, 'profile-save');

    expect(setMyDisplayName).toHaveBeenCalledTimes(1);
    expect(byTestId(renderer, 'profile-error').props.children).toBe(i18n.t('profile.photoInvalid'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('a photo picker error is shown and nothing is uploaded', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'error', message: 'no permission' });
    const renderer = await renderScreen();

    await press(renderer, 'profile-photo-change');

    expect(texts(renderer)).toContain('no permission');
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).not.toHaveBeenCalled();
  });

  it('shows a message when the profile cannot be loaded', async () => {
    jest.mocked(getMyProfile).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain(i18n.t('profile.loadFallback'));
  });
});
