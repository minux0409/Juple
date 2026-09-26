import { ApiError } from '../../api/ApiError';
import { submitInstagramMetadataCandidate } from '../../items/api/itemsApi';
import { previewInstagramMetadataCandidate } from '../api/urlMetadataApi';
import {
  applyInstagramDeviceFallback,
  needsInstagramDeviceFallback,
  previewInstagramDeviceFallback,
} from '../instagramDeviceFallback';
import { fetchInstagramOpenGraphCandidate } from '../instagramOpenGraphFetch';

jest.mock('../../items/api/itemsApi', () => ({
  submitInstagramMetadataCandidate: jest.fn(),
}));

jest.mock('../api/urlMetadataApi', () => ({
  previewInstagramMetadataCandidate: jest.fn(),
}));

jest.mock('../instagramOpenGraphFetch', () => ({
  ...jest.requireActual('../instagramOpenGraphFetch'),
  fetchInstagramOpenGraphCandidate: jest.fn(),
}));

const POST = 'https://www.instagram.com/p/SECRETCODE1/?igsh=SECRETIGSH';
const candidate = { ogTitle: 'SECRET CAPTION', ogImage: 'https://scontent.cdninstagram.com/v/secret.jpg', ogUrl: null, ogDescription: null };
const request = jest.fn();

describe('needsInstagramDeviceFallback', () => {
  it('runs only for an Instagram post/reel whose real title or image is missing', () => {
    expect(needsInstagramDeviceFallback(POST, { hasTitle: false, hasImage: false })).toBe(true);
    expect(needsInstagramDeviceFallback(POST, { hasTitle: true, hasImage: false })).toBe(true);
    expect(needsInstagramDeviceFallback(POST, { hasTitle: false, hasImage: true })).toBe(true);
    expect(needsInstagramDeviceFallback(POST, { hasTitle: true, hasImage: true })).toBe(false);
    expect(needsInstagramDeviceFallback('https://www.youtube.com/watch?v=x', { hasTitle: false, hasImage: false })).toBe(false);
    expect(needsInstagramDeviceFallback('https://www.instagram.com/some_user/', { hasTitle: false, hasImage: false })).toBe(false);
  });

  it('is decided from real metadata only - the display label "Instagram 게시물/릴스" is never an input', () => {
    // KnownMetadata carries only real Backend/share signals; a title-less Item that merely *displays*
    // the localized label (see resolveSavedLinkDisplayTitle) is still hasTitle: false.
    expect(needsInstagramDeviceFallback('https://www.instagram.com/reel/ABC/', { hasTitle: false, hasImage: false })).toBe(true);
  });
});

describe('applyInstagramDeviceFallback', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  it('submits the device candidate for the saved Item and returns the Backend result', async () => {
    jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
    jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 't', previewImageUrl: 'i', applied: true });

    expect(await applyInstagramDeviceFallback(request, 7, POST)).toEqual({ title: 't', previewImageUrl: 'i', applied: true });
    expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(request, 7, candidate);
  });

  it('reuses an already-started fetch instead of fetching again', async () => {
    jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 't', previewImageUrl: 'i', applied: true });

    await applyInstagramDeviceFallback(request, 7, POST, Promise.resolve({ outcome: 'candidate', candidate }));

    expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
    expect(submitInstagramMetadataCandidate).toHaveBeenCalledTimes(1);
  });

  it('is silent when the device fetch yields nothing, or the Backend rejects/fails', async () => {
    jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'loginRedirect', candidate: null });
    expect(await applyInstagramDeviceFallback(request, 7, POST)).toBeNull();
    expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();

    jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
    jest.mocked(submitInstagramMetadataCandidate).mockRejectedValueOnce(new ApiError('badRequest', 400));
    expect(await applyInstagramDeviceFallback(request, 7, POST)).toBeNull();

    jest.mocked(fetchInstagramOpenGraphCandidate).mockRejectedValueOnce(new Error('boom'));
    expect(await applyInstagramDeviceFallback(request, 7, POST)).toBeNull();
  });

  it('logs outcome categories only - never the URL or metadata values', async () => {
    jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
    jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 'SECRET CAPTION', previewImageUrl: candidate.ogImage, applied: true });

    await applyInstagramDeviceFallback(request, 7, POST);

    const logged = JSON.stringify(logSpy.mock.calls);
    for (const secret of ['SECRETCODE1', 'SECRETIGSH', 'SECRET CAPTION', 'secret.jpg']) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('previewInstagramDeviceFallback', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => logSpy.mockRestore());

  const normalized = { title: 'real title', previewImageUrl: 'https://scontent.cdninstagram.com/v/real.jpg' };

  it('sends the already-fetched raw candidate to the preview endpoint and returns only the normalized values', async () => {
    jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce(normalized);

    expect(await previewInstagramDeviceFallback(request, POST, Promise.resolve({ outcome: 'candidate', candidate }))).toEqual(normalized);
    expect(previewInstagramMetadataCandidate).toHaveBeenCalledWith(request, POST, candidate);
    expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
    expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
  });

  it('is null (silent) for no candidate, nothing usable, a 400 rejection, or a failure', async () => {
    expect(await previewInstagramDeviceFallback(request, POST, Promise.resolve({ outcome: 'loginRedirect', candidate: null }))).toBeNull();
    expect(previewInstagramMetadataCandidate).not.toHaveBeenCalled();

    const fetched = () => Promise.resolve({ outcome: 'candidate' as const, candidate });
    jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce({ title: null, previewImageUrl: null });
    expect(await previewInstagramDeviceFallback(request, POST, fetched())).toBeNull();

    jest.mocked(previewInstagramMetadataCandidate).mockRejectedValueOnce(new ApiError('badRequest', 400));
    expect(await previewInstagramDeviceFallback(request, POST, fetched())).toBeNull();

    expect(await previewInstagramDeviceFallback(request, POST, Promise.reject(new Error('timeout')))).toBeNull();
  });

  it('logs outcome categories only - never the URL or metadata values', async () => {
    jest.mocked(previewInstagramMetadataCandidate).mockResolvedValueOnce({ title: 'SECRET CAPTION', previewImageUrl: candidate.ogImage });

    await previewInstagramDeviceFallback(request, POST, Promise.resolve({ outcome: 'candidate', candidate }));

    const logged = JSON.stringify(logSpy.mock.calls);
    for (const secret of ['SECRETCODE1', 'SECRETIGSH', 'SECRET CAPTION', 'secret.jpg']) {
      expect(logged).not.toContain(secret);
    }
  });
});
