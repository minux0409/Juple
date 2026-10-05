import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { getCollection, getCollections, unlockCollection, type Collection } from '../api/collectionsApi';
import { CollectionUnlockDialog } from '../CollectionUnlockDialog';
import { useCategoryPickerModal, type UseCategoryPickerModalResult } from '../useCategoryPickerModal';
import { useCollectionDestinationPicker, type UseCollectionDestinationPickerResult } from '../useCollectionDestinationPicker';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../../categories/categorySnapshotSync', () => ({ syncCategorySnapshotToNative: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  getCollection: jest.fn(),
  getCollections: jest.fn(),
  unlockCollection: jest.fn(),
}));
jest.mock('../api/sharePasswordApi', () => ({ unlockSharePassword: jest.fn() }));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const make = (id: number, overrides: Partial<Collection> = {}): Collection => ({
  id,
  name: `컬렉션 ${id}`,
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '',
  updatedAtUtc: '',
  icon: 'folder',
  color: null,
  accessRole: 'owner',
  isLocked: false,
  ...overrides,
}) as Collection;

const t = i18n.t.bind(i18n);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function Harness({ onResult }: { onResult: (result: UseCategoryPickerModalResult) => void }) {
  const picker = useCategoryPickerModal((jest.requireMock('../../api/useAuthenticatedApi') as { useAuthenticatedApi: () => never }).useAuthenticatedApi(), t);
  onResult(picker);
  return (
    <CollectionUnlockDialog
      collection={picker.unlockTarget}
      onCancel={picker.cancelUnlock}
      onGranted={picker.onUnlockGranted}
      onStateChanged={picker.onUnlockStateChanged}
    />
  );
}

async function openPicker(cached: Collection[]) {
  jest.mocked(getCollections).mockResolvedValue({ items: cached, nextCursor: null });
  const ref: { current: UseCategoryPickerModalResult } = {} as never;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness onResult={result => { ref.current = result; }} />);
  });
  await act(async () => {
    await ref.current.open();
  });
  return { ref, renderer };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('a Collection chosen in the picker is judged by the server\'s CURRENT state', () => {
  it('cached locked -> the password was removed meanwhile: no prompt, the action goes on', async () => {
    const { ref } = await openPicker([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: false }));
    const toggle = jest.fn();

    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ref.current.unlockTarget).toBeNull();
    expect(ref.current.collectionPool[0].isLocked).toBe(false); // the card itself is refreshed too
  });

  it('cached unlocked -> a password was set meanwhile: the prompt appears and nothing is done unauthorized', async () => {
    const { ref } = await openPicker([make(1, { isLocked: false })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: true }));
    const toggle = jest.fn();

    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    expect(toggle).not.toHaveBeenCalled();
    expect(ref.current.unlockTarget?.id).toBe(1);
    expect(ref.current.unlockTarget?.isLocked).toBe(true);
  });

  it('the picker stays open across remote changes: every tap reads the server again', async () => {
    const { ref } = await openPicker([make(1, { isLocked: true })]);
    const toggle = jest.fn();

    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: false }));
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();
    expect(toggle).toHaveBeenCalledTimes(1);

    // The Owner turns the password back on; the very next tap sees it - no close / reopen needed.
    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: true }));
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ref.current.unlockTarget?.id).toBe(1);
    expect(getCollection).toHaveBeenCalledTimes(2);
  });

  it('a second tap while the state is being read is the same tap: one read, one action', async () => {
    const { ref } = await openPicker([make(1)]);
    let release!: (collection: Collection) => void;
    jest.mocked(getCollection).mockImplementation(() => new Promise<Collection>(resolve => { release = resolve; }));
    const toggle = jest.fn();

    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await act(async () => {
      release(make(1));
    });
    await flush();

    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('a Collection that is gone for the caller leaves the list with a clear message - the action never runs', async () => {
    const { ref } = await openPicker([make(1), make(2)]);
    jest.mocked(getCollection).mockRejectedValue(new ApiError('notFound', 404));
    const toggle = jest.fn();

    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    expect(toggle).not.toHaveBeenCalled();
    expect(ref.current.collectionPool.map(entry => entry.id)).toEqual([2]);
    expect(ref.current.error).toBe(t('collections.pickerCollectionUnavailable'));
  });

  it('if the server cannot be reached the cached state is used (the real action is enforced by the server anyway)', async () => {
    const { ref } = await openPicker([make(1, { isLocked: false })]);
    jest.mocked(getCollection).mockRejectedValue(new ApiError('unavailable'));
    const toggle = jest.fn();

    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    expect(toggle).toHaveBeenCalledTimes(1);
  });
});

describe('the password prompt is already open when the state changes', () => {
  const submit = async (renderer: ReactTestRenderer.ReactTestRenderer, password: string) => {
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'collection-unlock-password' && typeof node.props.onChangeText === 'function').props.onChangeText(password);
    });
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'collection-unlock-submit' && typeof node.props.onPress === 'function').props.onPress();
    });
    await flush();
  };

  it('the lock was removed after the prompt opened: submitting refreshes the state and CONTINUES - never "잠금을 해제하지 못했습니다."', async () => {
    const { ref, renderer } = await openPicker([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: true })); // the tap: still locked
    const toggle = jest.fn();
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();
    expect(ref.current.unlockTarget?.id).toBe(1);

    // Meanwhile the Owner removes the lock; the password is submitted.
    jest.mocked(unlockCollection).mockRejectedValue(new ApiError('conflict', 409, 'collectionNotLocked'));
    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: false }));
    await submit(renderer, 'whatever');

    expect(toggle).toHaveBeenCalledTimes(1); // the action the person tapped went on
    expect(ref.current.unlockTarget).toBeNull();
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).not.toContain(t('collections.lockUnlockFallback'));
  });

  it('a still-wrong password on a still-locked Collection is the normal wrong-password message, and the prompt stays', async () => {
    const { ref, renderer } = await openPicker([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: true }));
    const toggle = jest.fn();
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    jest.mocked(unlockCollection).mockRejectedValue(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    await submit(renderer, 'wrong');

    expect(toggle).not.toHaveBeenCalled();
    expect(ref.current.unlockTarget?.id).toBe(1);
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toContain(t('collections.lockWrongPassword'));
  });

  it('a correct password still grants and runs the action once (the normal path is unchanged)', async () => {
    const { ref, renderer } = await openPicker([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: true }));
    const toggle = jest.fn();
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'grant', expiresAtUtc: '2099-01-01T00:00:00Z' });
    await submit(renderer, 'right');

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(ref.current.unlockTokenFor(1)).toBe('grant');
    expect(unlockCollection).toHaveBeenCalledTimes(1);
  });

  it('the Collection turned out to be gone while the prompt was open: the prompt closes and the Collection leaves the list', async () => {
    const { ref, renderer } = await openPicker([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: true }));
    const toggle = jest.fn();
    ref.current.requestToggle(ref.current.collectionPool[0], toggle);
    await flush();

    jest.mocked(unlockCollection).mockRejectedValue(new ApiError('conflict', 409, 'collectionNotLocked'));
    jest.mocked(getCollection).mockRejectedValueOnce(new ApiError('notFound', 404));
    await submit(renderer, 'x');

    expect(toggle).not.toHaveBeenCalled();
    expect(ref.current.unlockTarget).toBeNull();
    expect(ref.current.collectionPool).toHaveLength(0);
  });
});

describe('the same rule on another Collection-selection surface (the 복제 / 이동 / 복사 destination picker)', () => {
  function DestinationHarness({ onResult }: { onResult: (result: UseCollectionDestinationPickerResult) => void }) {
    const picker = useCollectionDestinationPicker(
      (jest.requireMock('../../api/useAuthenticatedApi') as { useAuthenticatedApi: () => never }).useAuthenticatedApi(),
      t,
      { selection: 'multiple', onSubmit: async () => undefined, errorMessage: () => 'x' },
    );
    onResult(picker);
    return null;
  }

  async function openDestination(cached: Collection[]) {
    jest.mocked(getCollections).mockResolvedValue({ items: cached, nextCursor: null });
    const ref: { current: UseCollectionDestinationPickerResult } = {} as never;
    await act(async () => {
      ReactTestRenderer.create(<DestinationHarness onResult={result => { ref.current = result; }} />);
    });
    await act(async () => {
      ref.current.open();
    });
    await flush();
    return ref;
  }

  it('cached locked -> unlocked on the server: chosen at once, no prompt', async () => {
    const ref = await openDestination([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: false }));

    await act(async () => {
      ref.current.toggle(ref.current.collections[0]);
    });
    await flush();

    expect(ref.current.unlockTarget).toBeNull();
    expect(ref.current.selectedIds.has(1)).toBe(true);
  });

  it('cached unlocked -> locked on the server: the prompt, and nothing is chosen unauthorized', async () => {
    const ref = await openDestination([make(1, { isLocked: false })]);
    jest.mocked(getCollection).mockResolvedValue(make(1, { isLocked: true }));

    await act(async () => {
      ref.current.toggle(ref.current.collections[0]);
    });
    await flush();

    expect(ref.current.selectedIds.has(1)).toBe(false);
    expect(ref.current.unlockTarget?.id).toBe(1);
  });

  it('the password disappears while its prompt is open: refreshed, then chosen - no generic failure', async () => {
    const ref = await openDestination([make(1, { isLocked: true })]);
    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: true }));
    await act(async () => {
      ref.current.toggle(ref.current.collections[0]);
    });
    await flush();
    expect(ref.current.unlockTarget?.id).toBe(1);

    jest.mocked(getCollection).mockResolvedValueOnce(make(1, { isLocked: false }));
    let handled = false;
    await act(async () => {
      handled = await ref.current.onUnlockStateChanged();
    });

    expect(handled).toBe(true);
    expect(ref.current.unlockTarget).toBeNull();
    expect(ref.current.selectedIds.has(1)).toBe(true);
  });
});
