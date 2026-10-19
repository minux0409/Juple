import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { getCollection } from '../../collections/api/collectionsApi';
import { navigationRef } from '../../navigation/navigationRef';
import NativeCollectionShortcutsIOS from '../../share/specs/NativeCollectionShortcutsIOS';
import { iosCollectionShortcuts } from '../iosCollectionShortcuts';
import { CollectionShortcutRouter } from '../CollectionShortcutRouter';

// iOS: there is no Android NativeIncomingShare; the launch comes from the "컬렉션 열기" App Intent through NativeCollectionShortcutsIOS.
let mockLaunchListener: (() => void) | null = null;
jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../../collections/api/collectionsApi', () => ({ getCollection: jest.fn() }));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn(), getCurrentRoute: jest.fn(() => ({ name: 'MainTabs' })) } }));
jest.mock('../../share/specs/NativeIncomingShare', () => ({ __esModule: true, default: null }));
jest.mock('../../share/specs/NativeCollectionShortcutsIOS', () => ({
  __esModule: true,
  default: {
    consumeShortcutLaunch: jest.fn(),
    onShortcutLaunch: jest.fn((listener: () => void) => {
      mockLaunchListener = listener;
      return { remove: jest.fn(() => { mockLaunchListener = null; }) };
    }),
  },
}));
jest.mock('../CollectionShortcutService', () => ({ collectionShortcutService: { unpin: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../iosCollectionShortcuts', () => ({ iosCollectionShortcuts: { remove: jest.fn().mockResolvedValue(undefined) } }));

const native = NativeCollectionShortcutsIOS!;
const none = { openCollectionId: null, notice: null };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(navigationRef.isReady).mockReturnValue(true);
  jest.mocked(navigationRef.getCurrentRoute).mockReturnValue({ name: 'MainTabs' } as never);
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

describe('CollectionShortcutRouter (iOS "컬렉션 열기")', () => {
  it('cold start / after sign-in: the launch left by the shortcut opens that Collection once the backend confirms it', async () => {
    await render({ openCollectionId: 42, notice: null });

    expect(getCollection).toHaveBeenCalledWith(expect.anything(), 42);
    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
  });

  it('warm: a run that leaves its launch while the app is already in front is picked up from the native event', async () => {
    const renderer = await render(none);
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    jest.mocked(native.consumeShortcutLaunch).mockResolvedValue({ openCollectionId: 7, notice: null });
    jest.mocked(getCollection).mockResolvedValue({ id: 7, name: 'Food' } as never);
    await act(async () => {
      mockLaunchListener?.();
    });

    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 7 });
    act(() => renderer.unmount());
    expect(mockLaunchListener).toBeNull();
  });

  it.each([
    ['deleted (404)', new ApiError('notFound', 404)],
    ['another account / access revoked (403)', new ApiError('forbidden', 403)],
  ])('%s: nothing opens, it leaves the Shortcuts choices and the user is told', async (_name, error) => {
    jest.mocked(getCollection).mockRejectedValue(error);

    const renderer = await render({ openCollectionId: 42, notice: null });

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(iosCollectionShortcuts.remove).toHaveBeenCalledWith(42);
    expect(message(renderer)).toBe(i18n.t('collections.shortcutOpenUnavailable'));
  });

  it('a locked Collection still opens its own screen, which asks for the password (no bypass here)', async () => {
    jest.mocked(getCollection).mockResolvedValue({ id: 42, name: 'Trips', isLocked: true } as never);

    await render({ openCollectionId: 42, notice: null });

    expect(navigationRef.navigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 42 });
  });
});
