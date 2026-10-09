import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { getCollection } from '../../collections/api/collectionsApi';
import { navigationRef } from '../../navigation/navigationRef';
import NativeIncomingShare from '../../share/specs/NativeIncomingShare';
import { collectionShortcutService } from '../CollectionShortcutService';
import { CollectionShortcutRouter } from '../CollectionShortcutRouter';

jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../../collections/api/collectionsApi', () => ({ getCollection: jest.fn() }));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn(), getCurrentRoute: jest.fn(() => ({ name: 'MainTabs' })) } }));
jest.mock('../../share/specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: { consumeShortcutLaunch: jest.fn() },
}));
jest.mock('../CollectionShortcutService', () => ({ collectionShortcutService: { unpin: jest.fn().mockResolvedValue(undefined) } }));

const native = NativeIncomingShare!;

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(navigationRef.isReady).mockReturnValue(true);
  jest.mocked(navigationRef.getCurrentRoute).mockReturnValue({ name: 'MainTabs' } as never);
  jest.mocked(collectionShortcutService.unpin).mockResolvedValue(undefined);
  jest.mocked(getCollection).mockResolvedValue({ id: 42, name: 'Trips' } as never);
});

async function render(launch: { openCollectionId: number | null; notice: string | null }) {
  jest.mocked(native.consumeShortcutLaunch).mockResolvedValue(launch);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionShortcutRouter />);
  });
  return renderer;
}

const message = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0]?.props.message;

describe('CollectionShortcutRouter', () => {
  it('a launcher shortcut tap opens that Collection - after the backend confirms it is reachable', async () => {
    await render({ openCollectionId: 42, notice: null });

    expect(getCollection).toHaveBeenCalledWith(expect.anything(), 42);
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
  });

  it.each([
    ['deleted (404)', new ApiError('notFound', 404)],
    ['access revoked (403)', new ApiError('forbidden', 403)],
  ])('%s: nothing opens, the shortcut is removed, and the user is told', async (_name, error) => {
    jest.mocked(getCollection).mockRejectedValue(error);

    const renderer = await render({ openCollectionId: 42, notice: null });

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(collectionShortcutService.unpin).toHaveBeenCalledWith(42);
    expect(message(renderer)).toBe(i18n.t('collections.shortcutOpenUnavailable'));
  });

  it('offline: the Collection\'s own screen opens and shows its load failure with a retry (the shortcut is kept)', async () => {
    jest.mocked(getCollection).mockRejectedValue(new ApiError('unavailable', 503));

    await render({ openCollectionId: 42, notice: null });

    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
    expect(collectionShortcutService.unpin).not.toHaveBeenCalled();
  });

  it('a second tap (or a warm resume) while that Collection is already open pushes nothing on top of it', async () => {
    jest.mocked(navigationRef.getCurrentRoute).mockReturnValue({ name: 'CollectionDetails', params: { collectionId: 42 } } as never);

    await render({ openCollectionId: 42, notice: null });

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    // A different Collection still opens.
    jest.mocked(navigationRef.getCurrentRoute).mockReturnValue({ name: 'CollectionDetails', params: { collectionId: 7 } } as never);
    await render({ openCollectionId: 42, notice: null });
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
  });

  it('an icon made by another account fails the same safe way: the CURRENT account is asked, gets 404, nothing opens', async () => {
    jest.mocked(getCollection).mockRejectedValue(new ApiError('notFound', 404));
    const request = jest.fn();

    const renderer = await render({ openCollectionId: 42, notice: null });

    expect(getCollection).toHaveBeenCalledWith(expect.anything(), 42);
    expect(request).not.toHaveBeenCalled();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(message(renderer)).toBe(i18n.t('collections.shortcutOpenUnavailable'));
    expect(i18n.t('collections.shortcutOpenUnavailable')).toContain('아이콘');
  });

  it('shows the notice a failed Direct Share left (Collection no longer available) once', async () => {
    const renderer = await render({ openCollectionId: null, notice: 'targetUnavailable' });

    expect(message(renderer)).toBe(i18n.t('collections.shortcutUnavailable'));
    act(() => renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0].props.onConfirm());
    expect(message(renderer)).toBeUndefined();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('shows "saved, but not into the Collection" when the headless save could not add it', async () => {
    const renderer = await render({ openCollectionId: null, notice: 'savedWithoutCollection' });

    expect(message(renderer)).toBe(i18n.t('collections.shortcutSavedWithoutCollection'));
  });

  it('ignores a notice code it does not know, and does nothing when there is nothing to do', async () => {
    const renderer = await render({ openCollectionId: null, notice: 'somethingElse' });
    expect(message(renderer)).toBeUndefined();

    const idle = await render({ openCollectionId: null, notice: null });
    expect(message(idle)).toBeUndefined();
    expect(getCollection).not.toHaveBeenCalled();
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('looks again every time the app comes to the front (a tap while it was already running)', async () => {
    let listener: ((state: string) => void) | undefined;
    const remove = jest.fn();
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      listener = handler;
      return { remove };
    }) as never);

    await render({ openCollectionId: null, notice: null });
    expect(native.consumeShortcutLaunch).toHaveBeenCalledTimes(1);

    jest.mocked(native.consumeShortcutLaunch).mockResolvedValue({ openCollectionId: 42, notice: null });
    await act(async () => listener?.('active'));

    expect(native.consumeShortcutLaunch).toHaveBeenCalledTimes(2);
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
    spy.mockRestore();
  });
});
