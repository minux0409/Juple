import { AppRegistry } from 'react-native';
import { registerIncomingShareHeadlessTask } from '../incomingShareHeadlessTask';
import NativeIncomingShare from '../specs/NativeIncomingShare';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { updateItemDetails } from '../../items/api/itemsApi';
import { addItemToCollection } from '../../collections/api/collectionsApi';
import { ApiError } from '../../api/ApiError';

jest.mock('../specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPendingShares: jest.fn(),
    acknowledgePendingShare: jest.fn(),
    reportAttemptOutcome: jest.fn(),
  },
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  addItemToCollection: jest.fn(),
}));

function makePendingShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'share-1',
    text: 'https://example.com/a',
    receivedAtEpochMs: Date.now(),
    initialTitle: null,
    preselectedCollectionId: null,
    draftTitle: null,
    draftCollectionId: null,
    ...overrides,
  };
}

/** Retrieves the registered headless task function the same way AppRegistry/HeadlessJsTaskService would invoke it. Registered once for the whole file - re-registering the same task key on every test only produces noisy (harmless) console warnings. */
function getRegisteredTask(): (data: { pendingShareId?: string }) => Promise<void> {
  const spy = jest.spyOn(AppRegistry, 'registerHeadlessTask');
  registerIncomingShareHeadlessTask();
  const taskProvider = spy.mock.calls[0][1] as () => (data: { pendingShareId?: string }) => Promise<void>;
  spy.mockRestore();
  return taskProvider();
}

describe('incomingShareHeadlessTask', () => {
  const task = getRegisteredTask();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves the URL and acknowledges the pending share when there is no title/category', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id });

    expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), pendingShare.text, pendingShare.id);
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('sets the title when a draftTitle was confirmed in the composer', async () => {
    const pendingShare = makePendingShare({ draftTitle: 'My title' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 100, { title: 'My title', memo: '' });
  });

  it('links the confirmed category after saving', async () => {
    const pendingShare = makePendingShare({ draftCollectionId: 7 });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id });

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 7, 100);
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('does not acknowledge the pending share when only the category link fails (partial failure)', async () => {
    const pendingShare = makePendingShare({ draftCollectionId: 7 });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('unavailable'));

    await task({ pendingShareId: pendingShare.id });

    expect(NativeIncomingShare!.acknowledgePendingShare).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.reportAttemptOutcome).toHaveBeenCalledWith(pendingShare.id, 'retryableFailure');
  });

  it('retrying after a partial failure never creates a second Item (saveInboxEntry replays the same clientRequestId, only the category link is redone)', async () => {
    const pendingShare = makePendingShare({ draftCollectionId: 7 });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(addItemToCollection).mockRejectedValueOnce(new ApiError('unavailable'));
    jest.mocked(addItemToCollection).mockResolvedValueOnce(undefined);

    await task({ pendingShareId: pendingShare.id }); // first attempt: category link fails
    await task({ pendingShareId: pendingShare.id }); // retry: category link succeeds

    // saveInboxEntry is idempotent by clientRequestId - calling it again on retry is expected and
    // safe, but it must always be called with the SAME id, never creating a second Item.
    expect(saveInboxEntry).toHaveBeenCalledTimes(2);
    expect(saveInboxEntry).toHaveBeenNthCalledWith(1, expect.anything(), pendingShare.text, pendingShare.id);
    expect(saveInboxEntry).toHaveBeenNthCalledWith(2, expect.anything(), pendingShare.text, pendingShare.id);
    expect(addItemToCollection).toHaveBeenCalledTimes(2);
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledTimes(1);
  });

  it('reports reviewRequired and never saves when the shared text is not an exact URL', async () => {
    const pendingShare = makePendingShare({ text: 'Check this out: https://example.com/a' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);

    await task({ pendingShareId: pendingShare.id });

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.reportAttemptOutcome).toHaveBeenCalledWith(pendingShare.id, 'reviewRequired');
  });
});
