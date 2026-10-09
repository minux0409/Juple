import { AppRegistry } from 'react-native';
import { registerIncomingShareHeadlessTask } from '../incomingShareHeadlessTask';
import NativeIncomingShare from '../specs/NativeIncomingShare';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { addItemToCollection, getCollection, type Collection } from '../../collections/api/collectionsApi';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { ApiError } from '../../api/ApiError';

jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'dev.juple.co.kr' } }));
jest.mock('../specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPendingShares: jest.fn(),
    acknowledgePendingShare: jest.fn(),
    reportAttemptOutcome: jest.fn(),
    setShortcutNotice: jest.fn(),
  },
}));
jest.mock('../../inbox/api/inboxApi', () => ({ saveInboxEntry: jest.fn() }));
jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
  submitInstagramMetadataCandidate: jest.fn(),
}));
jest.mock('../../urlMetadata/instagramOpenGraphFetch', () => ({
  ...jest.requireActual('../../urlMetadata/instagramOpenGraphFetch'),
  fetchInstagramOpenGraphCandidate: jest.fn(async () => ({ outcome: 'noMetadata', candidate: null })),
}));
jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({ resolveUrlMetadata: jest.fn() }));
jest.mock('../../collections/api/collectionsApi', () => ({
  getCollection: jest.fn(),
  addItemToCollection: jest.fn(),
}));

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s';

const collection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 7,
  name: 'Trips',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  ...overrides,
});

function pendingShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'share-1',
    text: YOUTUBE,
    receivedAtEpochMs: Date.now(),
    initialTitle: null,
    preselectedCollectionId: 7,
    draftTitle: null,
    draftCollectionId: null,
    autoSave: true,
    ...overrides,
  };
}

function getRegisteredTask(): (data: { pendingShareId?: string }) => Promise<void> {
  const spy = jest.spyOn(AppRegistry, 'registerHeadlessTask');
  registerIncomingShareHeadlessTask();
  const taskProvider = spy.mock.calls[0][1] as () => (data: { pendingShareId?: string }) => Promise<void>;
  spy.mockRestore();
  return taskProvider();
}

const native = NativeIncomingShare!;

describe('Quick Save ON through a Collection\'s Direct Share row', () => {
  const task = getRegisteredTask();

  const run = async (share = pendingShare()) => {
    jest.mocked(native.getPendingShares).mockResolvedValue([share]);
    await task({ pendingShareId: share.id });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: YOUTUBE, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(getCollection).mockResolvedValue(collection());
    jest.mocked(addItemToCollection).mockResolvedValue('added');
    jest.mocked(native.setShortcutNotice).mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('saves the link (query string intact) and puts it into the chosen Collection, then finishes the share', async () => {
    await run();

    expect(getCollection).toHaveBeenCalledWith(expect.anything(), 7);
    expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), YOUTUBE, 'share-1');
    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 7, 100);
    expect(native.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
    expect(native.setShortcutNotice).not.toHaveBeenCalled();
  });

  it('the Collection is checked BEFORE anything is saved, and the order is check, save, add', async () => {
    const order: string[] = [];
    jest.mocked(getCollection).mockImplementation(async () => { order.push('check'); return collection(); });
    jest.mocked(saveInboxEntry).mockImplementation(async () => { order.push('save'); return { id: 100, url: YOUTUBE, savedAtUtc: '' }; });
    jest.mocked(addItemToCollection).mockImplementation(async () => { order.push('add'); return 'added'; });

    await run();

    expect(order).toEqual(['check', 'save', 'add']);
  });

  it('a plain Juple share (no Collection) touches no Collection endpoint at all', async () => {
    await run(pendingShare({ preselectedCollectionId: null }));

    expect(getCollection).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(saveInboxEntry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a Viewer (not a writable destination)', collection({ accessRole: 'viewer' })],
    ['a locked Collection', collection({ isLocked: true })],
    ['a Collection behind an access password', collection({ accessRole: 'contributor', isSharePasswordProtected: true })],
  ])('%s: nothing is saved and nothing goes anywhere else - the share waits for the review screen', async (_name, unusable) => {
    jest.mocked(getCollection).mockResolvedValue(unusable);

    await run();

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(native.acknowledgePendingShare).not.toHaveBeenCalled();
    expect(native.reportAttemptOutcome).toHaveBeenCalledWith('share-1', 'reviewRequired');
  });

  it.each([
    ['deleted / not mine (404)', new ApiError('notFound', 404)],
    ['no access (403)', new ApiError('forbidden', 403)],
  ])('%s: nothing is saved, the share waits for the review screen', async (_name, error) => {
    jest.mocked(getCollection).mockRejectedValue(error);

    await run();

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(native.reportAttemptOutcome).toHaveBeenCalledWith('share-1', 'reviewRequired');
  });

  it('a failed check (offline) is retried later - not saved yet, not given up on, not sent elsewhere', async () => {
    jest.mocked(getCollection).mockRejectedValue(new ApiError('unavailable', 503));

    await run();

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(native.reportAttemptOutcome).toHaveBeenCalledWith('share-1', 'retryableFailure');
    expect(native.acknowledgePendingShare).not.toHaveBeenCalled();
  });

  it('a Submitter\'s link follows the existing approval rule (it becomes a proposal) and the share is done', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection({ accessRole: 'submitter' }));
    jest.mocked(addItemToCollection).mockResolvedValue('submitted');

    await run();

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 7, 100);
    expect(native.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
  });

  it('a Contributor adds directly', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection({ accessRole: 'contributor' }));

    await run();

    expect(addItemToCollection).toHaveBeenCalledTimes(1);
    expect(native.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
  });

  it('a temporary failure while adding leaves the share for the retry (the save and the add are both idempotent)', async () => {
    jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('timeout'));

    await run();

    expect(native.reportAttemptOutcome).toHaveBeenCalledWith('share-1', 'retryableFailure');
    expect(native.acknowledgePendingShare).not.toHaveBeenCalled();
  });

  it('a permanent failure while adding (the Collection stopped taking links meanwhile): the link is kept, the share is done, and the user is told', async () => {
    jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('forbidden', 403));

    await run();

    expect(saveInboxEntry).toHaveBeenCalledTimes(1);
    expect(native.setShortcutNotice).toHaveBeenCalledWith('savedWithoutCollection');
    expect(native.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
  });

  it('"already in the Collection" is the goal reached, not a failure', async () => {
    jest.mocked(addItemToCollection).mockRejectedValue(new ApiError('conflict', 409, 'linkAlreadyInCollection'));

    await run();

    expect(native.setShortcutNotice).not.toHaveBeenCalled();
    expect(native.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
  });
});
