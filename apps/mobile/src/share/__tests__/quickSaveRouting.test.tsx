import ReactTestRenderer, { act } from 'react-test-renderer';
import { IncomingShareRouter } from '../IncomingShareRouter';
import NativeIncomingShare, { type PendingShare } from '../specs/NativeIncomingShare';
import { AUTO_SAVE_SETTLE_MS, notifyAutoSaveSettled } from '../autoSaveInFlight';
import { navigationRef } from '../../navigation/navigationRef';

// The real useIncomingShare + IncomingShareRouter over a mocked native queue: what the user sees
// when Juple comes to the front while a share is (or is not) being saved in the background.
jest.mock('../specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPendingShares: jest.fn(),
    acknowledgePendingShare: jest.fn(),
  },
}));

jest.mock('../activeNewLinkReviewDraft', () => ({
  getActiveNewLinkReviewDraft: jest.fn(() => null),
}));

jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: {
    isReady: jest.fn(() => true),
    navigate: jest.fn(),
  },
}));

// What YouTube's Share → Juple sends: the short link in EXTRA_TEXT, the video title as EXTRA_SUBJECT.
function youTubeShare(overrides: Partial<PendingShare> = {}): PendingShare {
  return {
    id: 'yt-1',
    text: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
    receivedAtEpochMs: Date.now(),
    initialTitle: 'Rick Astley - Never Gonna Give You Up',
    preselectedCollectionId: null,
    draftTitle: null,
    draftCollectionId: null,
    ...overrides,
  };
}

let queue: PendingShare[] = [];

beforeEach(() => {
  queue = [];
  jest.mocked(NativeIncomingShare!.getPendingShares).mockImplementation(async () => [...queue]);
  jest.mocked(NativeIncomingShare!.acknowledgePendingShare).mockImplementation(async (id: string) => {
    queue = queue.filter(share => share.id !== id);
  });
});

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function openApp() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<IncomingShareRouter />);
  });
  return renderer;
}

describe('Quick Save ON: a share being saved in the background is never opened for review', () => {
  it('YouTube share, app opened while the save is still running → NewLinkReview is NOT opened; the save finishing leaves nothing to review', async () => {
    queue = [youTubeShare({ autoSave: true, autoSaveOutcome: null })];
    await openApp();

    expect(navigationRef.navigate).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.acknowledgePendingShare).not.toHaveBeenCalled();

    // The background save succeeds: it removes the share and signals.
    queue = [];
    await act(async () => {
      notifyAutoSaveSettled();
    });

    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('when the background save ends without saving, the share is then shown for review (with its title)', async () => {
    queue = [youTubeShare({ autoSave: true, autoSaveOutcome: null })];
    await openApp();
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    queue = [youTubeShare({ autoSave: true, autoSaveOutcome: 'authenticationRequired' })];
    await act(async () => {
      notifyAutoSaveSettled();
    });

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', {
      url: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
      initialTitle: 'Rick Astley - Never Gonna Give You Up',
      preselectedCollectionId: null,
    });
  });

  it('a share whose save never reported back (process died) is shown for review once the save window has passed', async () => {
    jest.useFakeTimers();
    queue = [youTubeShare({ autoSave: true, autoSaveOutcome: null })];
    await openApp();
    expect(navigationRef.navigate).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(AUTO_SAVE_SETTLE_MS + 1000);
    });

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ url: 'https://youtu.be/dQw4w9WgXcQ?si=abc' }));
  });

  it('an ordinary (non-YouTube) Quick Save ON share is held back the same way - no per-site rule', async () => {
    queue = [youTubeShare({ id: 'web-1', text: 'https://example.com/article', initialTitle: null, autoSave: true })];
    await openApp();

    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('an Instagram Quick Save ON share whose save failed goes to review as before', async () => {
    queue = [youTubeShare({ id: 'ig-1', text: 'https://www.instagram.com/p/abc/', initialTitle: null, autoSave: true, autoSaveOutcome: 'retryableFailure' })];
    await openApp();

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ url: 'https://www.instagram.com/p/abc/' }));
  });
});

describe('Quick Save OFF: every share goes straight to review, as before', () => {
  it('YouTube share → NewLinkReview opened with the URL and the video title', async () => {
    queue = [youTubeShare({ autoSave: false })];
    await openApp();

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', {
      url: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
      initialTitle: 'Rick Astley - Never Gonna Give You Up',
      preselectedCollectionId: null,
    });
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith('yt-1');
  });

  it('an ordinary URL share → NewLinkReview opened', async () => {
    queue = [youTubeShare({ id: 'web-1', text: 'https://example.com/article', initialTitle: null, autoSave: false })];
    await openApp();

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ url: 'https://example.com/article' }));
  });

  it('a share queued by an older build (no autoSave field) is still reviewed as before', async () => {
    queue = [youTubeShare()];
    await openApp();

    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
  });
});
