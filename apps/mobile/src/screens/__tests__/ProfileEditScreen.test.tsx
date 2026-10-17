import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Platform, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { getMyProfile, removeMyProfileImage, setMyDisplayName, setMyProfileImage } from '../../api/profileApi';
import { pickCollectionIconImage } from '../../collections/collectionIconImage';
import { resetProfileImageCacheForTests } from '../../profile/profileImageCache';
import { AppToastProvider } from '../../components/AppToast';
import { CheckIcon } from '../../icons/CheckIcon';
import { CopyIcon } from '../../icons/CopyIcon';
import { ProfileEditScreen } from '../ProfileEditScreen';
import ImageEditor from '@react-native-community/image-editor';
import { Modal } from 'react-native';

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
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <ProfileEditScreen />
      </AppToastProvider>,
    );
  });
  return renderer;
}

const byTestId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findByProps({ testID });
const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const pressable = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

const photoMenu = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => Array.isArray(node.props.actions) && typeof node.props.onDismiss === 'function')[0];
const photoMenuLabels = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  photoMenu(renderer).props.actions.map((action: { label: string }) => action.label);

/**
 * Opens the photo menu (from the avatar or its pencil) and picks one of its rows. The test renderer
 * runs as iOS, where the chosen action waits for the menu's onDismiss - fired here as the OS would.
 */
async function choosePhotoAction(renderer: ReactTestRenderer.ReactTestRenderer, label: string, from = 'profile-photo') {
  await act(async () => pressable(renderer, from).props.onPress());
  expect(photoMenu(renderer).props.visible).toBe(true);
  const row = renderer.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];
  await act(async () => row.props.onPress());
  expect(photoMenu(renderer).props.visible).toBe(false);
  await act(async () => photoMenu(renderer).props.onDismiss());
}

/** The photo is now in the cropper (a 1200 x 900 picture): press 적용. */
async function applyCrop(renderer: ReactTestRenderer.ReactTestRenderer) {
  await act(async () => pressable(renderer, 'photo-cropper-apply').props.onPress());
}

/** 사진 삭제 → the "프로필 사진을 삭제할까요?" confirmation's 삭제. */
async function confirmPhotoRemoval(renderer: ReactTestRenderer.ReactTestRenderer) {
  await choosePhotoAction(renderer, '사진 삭제');
  expect(texts(renderer)).toContain(i18n.t('profile.removePhotoConfirmTitle'));
  const confirm = renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('common.delete') && typeof node.props.onPress === 'function');
  await act(async () => confirm[confirm.length - 1].props.onPress());
}
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
    // No helper text under the nickname or the Juple ID any more.
    expect(texts(renderer)).not.toContain('다른 사람에게 보이는 이름이에요. 비워 두면 Juple ID가 대신 보여요.');
    expect(JSON.stringify(texts(renderer))).not.toContain('바꿀 수 없어요');
    // The avatar is the photo button, with a small neutral pencil on its corner - no red × any more.
    expect(pressable(renderer, 'profile-photo').props.accessibilityLabel).toBe('프로필 사진 변경');
    expect(pressable(renderer, 'profile-photo-edit').props.accessibilityLabel).toBe('프로필 사진 편집');
    expect(has(renderer, 'profile-photo-remove')).toBe(false);
    expect(has(renderer, 'profile-photo-change')).toBe(false);
  });

  it('keeps the copy icon inside the Juple ID field - no separate 복사 text button', async () => {
    const renderer = await renderScreen();

    const field = byTestId(renderer, 'profile-juple-id');
    const copy = field.findAll(node => node.props.testID === 'profile-juple-id-copy' && typeof node.props.onPress === 'function');
    expect(copy).toHaveLength(1);
    expect(copy[0].props.accessibilityLabel).toBe('Juple ID 복사');
    expect(copy[0].findAllByType(CopyIcon)).toHaveLength(1);
    expect(texts(renderer)).not.toContain('복사');
  });

  it('copies the Juple ID exactly as shown (@XXXX-XXXX, never the raw id), with no toast of its own', async () => {
    jest.useFakeTimers();
    try {
      const renderer = await renderScreen();
      expect(byTestId(renderer, 'profile-juple-id').findByType(Text).props.children).toBe('@K7MP-4Q8N');

      await act(async () => pressable(renderer, 'profile-juple-id-copy').props.onPress());
      expect(Clipboard.setString).toHaveBeenCalledTimes(1);
      expect(Clipboard.setString).toHaveBeenCalledWith('@K7MP-4Q8N');
      expect(Clipboard.setString).not.toHaveBeenCalledWith('K7MP4Q8N');
      // Android already says "copied" itself; the app only turns the icon into a check for a moment.
      expect(JSON.stringify(texts(renderer))).not.toContain('복사했어요');
      expect(pressable(renderer, 'profile-juple-id-copy').findAllByType(CheckIcon)).toHaveLength(1);

      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      expect(pressable(renderer, 'profile-juple-id-copy').findAllByType(CopyIcon)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('the avatar and its pencil open the same menu: 사진 변경 / 사진 삭제 with a photo', async () => {
    const renderer = await renderScreen();

    for (const from of ['profile-photo', 'profile-photo-edit']) {
      await act(async () => pressable(renderer, from).props.onPress());
      expect(photoMenu(renderer).props.visible).toBe(true);
      expect(photoMenuLabels(renderer)).toEqual(['사진 변경', '사진 삭제']);
      expect(photoMenu(renderer).props.actions.map((action: { destructive?: boolean }) => action.destructive === true)).toEqual([false, true]);
      await act(async () => photoMenu(renderer).props.onCancel());
      expect(photoMenu(renderer).props.visible).toBe(false);
    }
    expect(pickCollectionIconImage).not.toHaveBeenCalled();
  });

  it('offers only 사진 선택 while there is no photo', async () => {
    jest.mocked(getMyProfile).mockResolvedValue({ ...PROFILE, profileImageUrl: null, profileImageVersion: null });
    const renderer = await renderScreen();

    expect(has(renderer, 'profile-photo-edit')).toBe(true);
    await act(async () => pressable(renderer, 'profile-photo-edit').props.onPress());
    expect(photoMenuLabels(renderer)).toEqual(['사진 선택']);
  });

  it('opens the picker once, after the menu has closed - never twice for repeated taps', async () => {
    let finishPick!: (value: { kind: 'cancelled' }) => void;
    jest.mocked(pickCollectionIconImage).mockReturnValue(new Promise(resolve => { finishPick = resolve; }));
    const renderer = await renderScreen();

    await act(async () => pressable(renderer, 'profile-photo-edit').props.onPress());
    const change = renderer.root.findAll(node => node.props.accessibilityLabel === '사진 변경' && typeof node.props.onPress === 'function')[0];
    await act(async () => change.props.onPress());
    expect(pickCollectionIconImage).not.toHaveBeenCalled(); // iOS: not while the menu is still closing
    await act(async () => photoMenu(renderer).props.onDismiss());
    expect(pickCollectionIconImage).toHaveBeenCalledTimes(1);

    // While the system picker is open, the photo can't reopen the menu, and a stray dismiss runs nothing.
    await act(async () => pressable(renderer, 'profile-photo').props.onPress());
    expect(photoMenu(renderer).props.visible).toBe(false);
    await act(async () => photoMenu(renderer).props.onDismiss());
    expect(pickCollectionIconImage).toHaveBeenCalledTimes(1);

    await act(async () => finishPick({ kind: 'cancelled' }));
    expect(setMyProfileImage).not.toHaveBeenCalled();
  });

  it('on Android runs the chosen action right away (there is no onDismiss there)', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'cancelled' });
      const renderer = await renderScreen();

      await act(async () => pressable(renderer, 'profile-photo').props.onPress());
      const change = renderer.root.findAll(node => node.props.accessibilityLabel === '사진 변경' && typeof node.props.onPress === 'function')[0];
      await act(async () => change.props.onPress());
      expect(pickCollectionIconImage).toHaveBeenCalledTimes(1);
    } finally {
      os.restore();
    }
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

    await choosePhotoAction(renderer, '사진 변경');
    // The picked photo opens the cropper; nothing is previewed or sent until it is applied.
    expect(renderer.root.findAll(node => node.props.testID === 'photo-cropper').length).toBeGreaterThan(0);
    expect(setMyProfileImage).not.toHaveBeenCalled();
    await applyCrop(renderer);
    expect(byTestId(renderer, 'user-avatar-image').findByType(Image).props.source.uri).toBe('file:///cache/cropped.jpg');
    expect(setMyProfileImage).not.toHaveBeenCalled();

    await press(renderer, 'profile-save');
    expect(setMyProfileImage).toHaveBeenCalledWith(expect.anything(), { uri: 'file:///cache/cropped.jpg', type: 'image/jpeg', fileName: 'profile.jpg' });
    expect(setMyDisplayName).not.toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('사진 삭제 asks first, then deletes the photo right away (never opening the picker), falling back to the initial', async () => {
    jest.mocked(removeMyProfileImage).mockResolvedValue({ ...PROFILE, profileImageUrl: null, profileImageVersion: null });
    const renderer = await renderScreen();

    // Cancelling the confirmation changes nothing.
    await choosePhotoAction(renderer, '사진 삭제', 'profile-photo-edit');
    expect(texts(renderer)).toContain('프로필 사진을 삭제할까요?');
    const cancel = renderer.root.findAll(node => node.props.accessibilityLabel === i18n.t('common.cancel') && typeof node.props.onPress === 'function');
    await act(async () => cancel[cancel.length - 1].props.onPress());
    expect(removeMyProfileImage).not.toHaveBeenCalled();

    await confirmPhotoRemoval(renderer);
    expect(pickCollectionIconImage).not.toHaveBeenCalled();
    expect(removeMyProfileImage).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll(node => node.props.testID === 'user-avatar-image')).toHaveLength(0);
    await act(async () => pressable(renderer, 'profile-photo').props.onPress());
    expect(photoMenuLabels(renderer)).toEqual(['사진 선택']);
    await act(async () => photoMenu(renderer).props.onCancel());
    expect(mockGoBack).not.toHaveBeenCalled(); // no save needed

    await press(renderer, 'profile-save');
    expect(removeMyProfileImage).toHaveBeenCalledTimes(1);
  });

  it('a failed removal keeps the photo and says so', async () => {
    jest.mocked(removeMyProfileImage).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    await confirmPhotoRemoval(renderer);
    expect(byTestId(renderer, 'profile-error').props.children).toBe(i18n.t('profile.photoSaveFallback'));
    expect(renderer.root.findAllByProps({ testID: 'user-avatar-image' }).length).toBeGreaterThan(0);
  });

  it('사진 삭제 on a just-picked photo only drops the pick - nothing is deleted on the server', async () => {
    jest.mocked(getMyProfile).mockResolvedValue({ ...PROFILE, profileImageUrl: null, profileImageVersion: null });
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///new.jpg', type: 'image/jpeg' } });
    const renderer = await renderScreen();

    await choosePhotoAction(renderer, '사진 선택');
    await applyCrop(renderer);
    await confirmPhotoRemoval(renderer);
    expect(removeMyProfileImage).not.toHaveBeenCalled();
    expect(renderer.root.findAll(node => node.props.testID === 'user-avatar-image')).toHaveLength(0);
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).not.toHaveBeenCalled();
  });

  it('a rejected photo keeps the user on the screen with a message (the nickname is already saved)', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///big.jpg' } });
    jest.mocked(setMyDisplayName).mockResolvedValue({ ...PROFILE, displayName: '파이리' });
    jest.mocked(setMyProfileImage).mockRejectedValue(new ApiError('badRequest', 400));
    const renderer = await renderScreen();

    await typeNickname(renderer, '파이리');
    await choosePhotoAction(renderer, '사진 변경');
    await applyCrop(renderer);
    await press(renderer, 'profile-save');

    expect(setMyDisplayName).toHaveBeenCalledTimes(1);
    expect(byTestId(renderer, 'profile-error').props.children).toBe(i18n.t('profile.photoInvalid'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('a photo picker error is shown and nothing is uploaded', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'error', message: 'no permission' });
    const renderer = await renderScreen();

    await choosePhotoAction(renderer, '사진 변경');

    expect(texts(renderer)).toContain('no permission');
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).not.toHaveBeenCalled();
  });

  it('shows a message when the profile cannot be loaded', async () => {
    jest.mocked(getMyProfile).mockRejectedValue(new Error('offline'));
    const renderer = await renderScreen();

    expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('importantState.loadFailedTitle'), i18n.t('importantState.loadFailedMessage')]));
  });
});

describe('ProfileEditScreen - the photo cropper', () => {
  const cropper = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'photo-cropper');
  const cropperModal = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAllByType(Modal).find(modal => modal.props.visible && modal.findAll(node => node.props.testID === 'photo-cropper').length > 0)!;

  beforeEach(() => {
    jest.mocked(ImageEditor.cropImage).mockClear();
    jest.spyOn(Image, 'getSize').mockImplementation(((_uri: string, success: (width: number, height: number) => void) => success(1200, 900)) as never);
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///new.jpg', type: 'image/jpeg' } });
  });

  it('a picked photo opens the cropper at once - nothing is previewed, cropped or uploaded yet', async () => {
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    expect(cropper(renderer).length).toBeGreaterThan(0);
    expect(ImageEditor.cropImage).not.toHaveBeenCalled();
    expect(setMyProfileImage).not.toHaveBeenCalled();
    expect(pickCollectionIconImage).toHaveBeenCalledWith(expect.anything(), { maxEdge: 1600, quality: 0.9 });
  });

  it('Cancel (and the Android back button) closes it, keeps the current photo and uploads nothing', async () => {
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await act(async () => pressable(renderer, 'photo-cropper-cancel').props.onPress());
    expect(cropper(renderer)).toHaveLength(0);

    await choosePhotoAction(renderer, '사진 변경');
    await act(async () => cropperModal(renderer).props.onRequestClose());
    expect(cropper(renderer)).toHaveLength(0);

    expect(renderer.root.findAllByType(Image).some(image => image.props.source?.uri === 'file:///new.jpg')).toBe(false);
    expect(ImageEditor.cropImage).not.toHaveBeenCalled();
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).not.toHaveBeenCalled();
  });

  it('Apply crops exactly the visible 1:1 square (the centred 900 x 900 of a 1200 x 900 photo), exported at 512 px at most', async () => {
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await applyCrop(renderer);
    expect(ImageEditor.cropImage).toHaveBeenCalledTimes(1);
    const [uri, data] = jest.mocked(ImageEditor.cropImage).mock.calls[0];
    expect(uri).toBe('file:///new.jpg');
    expect(data).toMatchObject({ offset: { x: 150, y: 0 }, size: { width: 900, height: 900 }, displaySize: { width: 512, height: 512 }, format: 'jpeg' });
    expect(cropper(renderer)).toHaveLength(0);
  });

  it('uses the picker-reported size (EXIF applied, the space the native crop works in) instead of asking the image again', async () => {
    jest.mocked(pickCollectionIconImage).mockResolvedValue({ kind: 'picked', asset: { uri: 'file:///portrait.jpg', type: 'image/jpeg', width: 600, height: 1000 } });
    const getSize = jest.spyOn(Image, 'getSize');
    getSize.mockClear();
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await applyCrop(renderer);
    expect(getSize).not.toHaveBeenCalled();
    const [, data] = jest.mocked(ImageEditor.cropImage).mock.calls[0];
    // a portrait photo: the centred 600 x 600 square, nothing is enlarged (600 < 1600, exported at its own size 512 max)
    expect(data).toMatchObject({ offset: { x: 0, y: 200 }, size: { width: 600, height: 600 }, displaySize: { width: 512, height: 512 } });
  });

  it('a second Apply while the crop runs does nothing', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(ImageEditor.cropImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }) as never);
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await act(async () => { pressable(renderer, 'photo-cropper-apply').props.onPress(); });
    await act(async () => { pressable(renderer, 'photo-cropper-apply').props.onPress(); });
    expect(ImageEditor.cropImage).toHaveBeenCalledTimes(1);
    await act(async () => finish({ uri: 'file:///cache/cropped.jpg', type: 'image/jpeg' }));
    expect(cropper(renderer)).toHaveLength(0);
  });

  it('a crop that fails keeps the cropper open with a message and the current photo untouched; it can be retried', async () => {
    jest.mocked(ImageEditor.cropImage).mockRejectedValueOnce(new Error('native'));
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await applyCrop(renderer);
    expect(cropper(renderer).length).toBeGreaterThan(0);
    expect(byTestId(renderer, 'photo-cropper-error')).toBeDefined();
    expect(setMyProfileImage).not.toHaveBeenCalled();
    await applyCrop(renderer);
    expect(cropper(renderer)).toHaveLength(0);
  });

  it('an upload that fails after the crop keeps the saved photo (the profile is not changed) and can be retried', async () => {
    jest.mocked(setMyProfileImage).mockRejectedValueOnce(new ApiError('unavailable'));
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    await applyCrop(renderer);
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).toHaveBeenCalledTimes(1);
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(byTestId(renderer, 'profile-error')).toBeDefined();
    jest.mocked(setMyProfileImage).mockResolvedValueOnce({ ...PROFILE, profileImageUrl: 'https://blob/new?sig=1', profileImageVersion: 'v2' });
    await press(renderer, 'profile-save');
    expect(setMyProfileImage).toHaveBeenCalledTimes(2);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('the controls are labelled and the area is an adjustable element with zoom actions (screen readers); zooming in shrinks the square', async () => {
    const renderer = await renderScreen();
    await choosePhotoAction(renderer, '사진 변경');
    const area = renderer.root.findAll(node => node.props.testID === 'photo-cropper-area' && node.props.accessibilityRole === 'adjustable')[0];
    expect(area.props.accessibilityLabel).toBe(i18n.t('profileCrop.areaA11y'));
    expect(area.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['increment', 'decrement']);
    for (const id of ['photo-cropper-apply', 'photo-cropper-cancel', 'photo-cropper-zoom-in', 'photo-cropper-zoom-out']) {
      expect(pressable(renderer, id).props.accessibilityRole).toBe('button');
      expect(typeof pressable(renderer, id).props.accessibilityLabel).toBe('string');
    }
    await act(async () => pressable(renderer, 'photo-cropper-zoom-in').props.onPress());
    await applyCrop(renderer);
    const [, data] = jest.mocked(ImageEditor.cropImage).mock.calls[0];
    expect(data.size.width).toBeLessThan(900);
    expect(data.size.width).toBe(data.size.height);
  });
});
