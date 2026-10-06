import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { getCollections, type Collection } from '../api/collectionsApi';
import { useCategoryPickerModal, type UseCategoryPickerModalResult } from '../useCategoryPickerModal';

jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  getCollections: jest.fn(),
}));

function collection(id: number): Collection {
  return { id, name: `C${id}`, isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '', icon: 'Folder', color: null };
}

let picker!: UseCategoryPickerModalResult;
function Host() {
  picker = useCategoryPickerModal(jest.fn() as never, i18n.t.bind(i18n));
  return null;
}

async function mount() {
  await act(async () => {
    ReactTestRenderer.create(<Host />);
  });
}

afterEach(() => jest.clearAllMocks());

describe('Collection picker - list load failures are their own state, not an action error', () => {
  it('a failed first load is a loadFailure (the sheet stays open) - and retrying loads the list', async () => {
    jest.mocked(getCollections).mockRejectedValueOnce(new ApiError('unavailable'));
    await mount();

    await act(async () => {
      await picker.open();
    });
    expect(picker.isVisible).toBe(true);
    expect(picker.loadFailure).not.toBeNull();
    expect(picker.loadFailure?.notice).toBeNull(); // the standard wording, not a screen-specific sentence
    expect(picker.error).toBeNull();

    jest.mocked(getCollections).mockResolvedValue({ items: [collection(1)], nextCursor: null });
    await act(async () => {
      picker.retryLoad();
    });
    expect(picker.loadFailure).toBeNull();
    expect(picker.collectionPool.map(entry => entry.id)).toEqual([1]);
  });

  it('signed out is a definite state with its own sentence', async () => {
    jest.mocked(getCollections).mockRejectedValueOnce(new ApiError('unauthorized', 401));
    await mount();
    await act(async () => {
      await picker.open();
    });
    expect(picker.loadFailure?.notice).toBe(i18n.t('errors.unauthorized'));
  });

  it('a failed next page keeps the loaded options and marks a load failure (retry loads the next page)', async () => {
    jest.mocked(getCollections).mockResolvedValueOnce({ items: [collection(1)], nextCursor: 'c1' });
    await mount();
    await act(async () => {
      await picker.open();
    });

    jest.mocked(getCollections).mockRejectedValueOnce(new ApiError('unavailable'));
    await act(async () => {
      picker.loadMore();
    });
    expect(picker.collectionPool.map(entry => entry.id)).toEqual([1]);
    expect(picker.loadFailure).not.toBeNull();

    jest.mocked(getCollections).mockResolvedValueOnce({ items: [collection(2)], nextCursor: null });
    await act(async () => {
      picker.retryLoad();
    });
    expect(picker.loadFailure).toBeNull();
    expect(picker.collectionPool.map(entry => entry.id)).toEqual([1, 2]);
  });
});
