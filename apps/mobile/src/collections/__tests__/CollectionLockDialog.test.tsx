import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionLockDialog, type CollectionLockDialogMode } from '../CollectionLockDialog';
import { removeCollectionLock, setCollectionLock } from '../api/collectionsApi';
import { getCollectionLockPasswordStatus } from '../api/collectionLockPasswordApi';
import { forgetCollectionUnlock } from '../collectionUnlockGrants';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../api/collectionsApi', () => ({
  setCollectionLock: jest.fn().mockResolvedValue(undefined),
  removeCollectionLock: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../api/collectionLockPasswordApi', () => ({
  getCollectionLockPasswordStatus: jest.fn(),
}));
jest.mock('../collectionUnlockGrants', () => ({ forgetCollectionUnlock: jest.fn() }));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(getCollectionLockPasswordStatus).mockResolvedValue({ isConfigured: true, passwordChangedAtUtc: '2026-09-27T00:00:00Z' });
});

afterEach(() => jest.clearAllMocks());

type Renderer = ReactTestRenderer.ReactTestRenderer;

async function render(mode: CollectionLockDialogMode, handlers: { onChanged?: jest.Mock; onOpenSettings?: jest.Mock } = {}) {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionLockDialog
        collectionId={5}
        mode={mode}
        onCancel={jest.fn()}
        onChanged={handlers.onChanged ?? jest.fn()}
        onOpenSettings={handlers.onOpenSettings ?? jest.fn()}
        visible
      />,
    );
  });
  return renderer;
}

const fieldIds = (renderer: Renderer) => renderer.root.findAllByType(TextInput).map(node => node.props.testID);
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const press = async (renderer: Renderer, testID: string) => {
  await act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
};

describe('CollectionLockDialog - the Owner\'s one lock password', () => {
  it('잠금 설정 with a lock password set: a confirmation only - no password field, nothing sent but the lock', async () => {
    const onChanged = jest.fn();
    const renderer = await render('lock', { onChanged });

    expect(fieldIds(renderer)).toEqual([]);
    expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('collections.lockConfirmTitle'), i18n.t('collections.lockConfirmMessage')]));

    await press(renderer, 'lock-save');
    expect(setCollectionLock).toHaveBeenCalledWith(expect.anything(), 5);
    expect(forgetCollectionUnlock).toHaveBeenCalledWith(5);
    expect(onChanged).toHaveBeenCalled();
  });

  it('잠금 설정 without a lock password: asks to set one first and offers Settings instead - nothing is locked', async () => {
    jest.mocked(getCollectionLockPasswordStatus).mockResolvedValue({ isConfigured: false, passwordChangedAtUtc: null });
    const onOpenSettings = jest.fn();
    const renderer = await render('lock', { onOpenSettings });

    expect(texts(renderer)).toContain(i18n.t('collections.lockPasswordNotConfigured'));
    expect(fieldIds(renderer)).toEqual([]);
    await press(renderer, 'lock-open-settings');

    expect(onOpenSettings).toHaveBeenCalled();
    expect(setCollectionLock).not.toHaveBeenCalled();
  });

  it('if the server says no lock password exists after all, the dialog switches to the Settings prompt', async () => {
    jest.mocked(setCollectionLock).mockRejectedValueOnce(new ApiError('conflict', 409, 'collectionLockPasswordNotConfigured'));
    const renderer = await render('lock');

    await press(renderer, 'lock-save');

    expect(texts(renderer)).toContain(i18n.t('collections.lockPasswordNotConfigured'));
    expect(renderer.root.findAllByProps({ testID: 'lock-open-settings' }).length).toBeGreaterThan(0);
  });

  it('잠금 해제하기 asks for the lock password and sends it to the server - the Owner has no bypass', async () => {
    const onChanged = jest.fn();
    const renderer = await render('remove', { onChanged });
    expect(fieldIds(renderer)).toEqual(['lock-current-password']);

    await press(renderer, 'lock-remove');
    expect(removeCollectionLock).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(i18n.t('collections.lockPasswordRequired'));

    await act(async () => {
      renderer.root.findByProps({ testID: 'lock-current-password' }).props.onChangeText('common-pass');
    });
    await press(renderer, 'lock-remove');
    expect(removeCollectionLock).toHaveBeenCalledWith(expect.anything(), 5, 'common-pass');
    expect(onChanged).toHaveBeenCalled();
  });

  it('a wrong lock password keeps the dialog open with the reason', async () => {
    jest.mocked(removeCollectionLock).mockRejectedValueOnce(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    const onChanged = jest.fn();
    const renderer = await render('remove', { onChanged });
    await act(async () => {
      renderer.root.findByProps({ testID: 'lock-current-password' }).props.onChangeText('wrong-pass');
    });

    await press(renderer, 'lock-remove');

    expect(texts(renderer)).toContain(i18n.t('collections.lockWrongPassword'));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
