import { ApiError } from '../../api/ApiError';
import { getCollection, type Collection } from '../../collections/api/collectionsApi';
import { resolveShareDestination, validateClaimedDestination } from '../resolveShareDestination';

jest.mock('../../collections/api/collectionsApi', () => ({ getCollection: jest.fn() }));

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

beforeEach(() => {
  jest.mocked(getCollection).mockReset();
  jest.mocked(getCollection).mockResolvedValue(collection());
});

describe('resolveShareDestination - an Intent/draft Collection id is a claim, never authority', () => {
  it('usable: the Owner, a Contributor and a Submitter (whose links stay proposals)', async () => {
    for (const accessRole of ['owner', 'contributor', 'submitter'] as const) {
      jest.mocked(getCollection).mockResolvedValue(collection({ accessRole }));
      expect((await resolveShareDestination(jest.fn(), 7)).status).toBe('usable');
    }
  });

  it.each([
    ['a Viewer', collection({ accessRole: 'viewer' })],
    ['a locked Collection', collection({ isLocked: true })],
    ['a Collection behind an access password', collection({ accessRole: 'contributor', isSharePasswordProtected: true })],
  ])('unusable: %s', async (_name, value) => {
    jest.mocked(getCollection).mockResolvedValue(value);
    expect((await resolveShareDestination(jest.fn(), 7)).status).toBe('unusable');
  });

  it('unusable: gone (404) or not this account\'s (403) - the check is made with the CURRENT signed-in user\'s request', async () => {
    const request = jest.fn();
    jest.mocked(getCollection).mockRejectedValueOnce(new ApiError('notFound', 404));
    expect((await resolveShareDestination(request, 7)).status).toBe('unusable');
    jest.mocked(getCollection).mockRejectedValueOnce(new ApiError('forbidden', 403));
    expect((await resolveShareDestination(request, 7)).status).toBe('unusable');
    expect(getCollection).toHaveBeenCalledWith(request, 7);
  });

  it('a failed check (offline, server) is thrown to the caller, not read as "unusable"', async () => {
    jest.mocked(getCollection).mockRejectedValue(new ApiError('unavailable', 503));
    await expect(resolveShareDestination(jest.fn(), 7)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('validateClaimedDestination - the one decision for every path that preselects a Collection', () => {
  it('no claim: nothing asked, nothing preselected', async () => {
    expect(await validateClaimedDestination(jest.fn(), null)).toEqual({ collectionId: null, unavailable: false });
    expect(getCollection).not.toHaveBeenCalled();
  });

  it('usable keeps the id', async () => {
    expect(await validateClaimedDestination(jest.fn(), 7)).toEqual({ collectionId: 7, unavailable: false });
  });

  it('unusable drops the id (never another one) and reports it', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection({ isLocked: true }));
    expect(await validateClaimedDestination(jest.fn(), 7)).toEqual({ collectionId: null, unavailable: true });
  });

  it('a failed check keeps the claim - the real save is judged by the server', async () => {
    jest.mocked(getCollection).mockRejectedValue(new Error('offline'));
    expect(await validateClaimedDestination(jest.fn(), 7)).toEqual({ collectionId: 7, unavailable: false });
  });
});
