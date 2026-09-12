import { AppRegistry } from 'react-native';
import { registerIncomingShareHeadlessTask } from '../incomingShareHeadlessTask';
import NativeIncomingShare from '../specs/NativeIncomingShare';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { updateItemDetails } from '../../items/api/itemsApi';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { checkUrlSafety } from '../../urlSafety/api/urlSafetyApi';
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

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
}));

jest.mock('../../urlSafety/api/urlSafetyApi', () => ({
  checkUrlSafety: jest.fn(),
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
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null });
    jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'noKnownThreat', threats: [] });
  });

  it('saves the URL as-is, falls back to URL metadata, and acknowledges the pending share - no title from metadata either', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id });

    expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), pendingShare.text, pendingShare.id);
    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), pendingShare.text);
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('applies a title resolved from URL metadata when the share itself had none', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 101, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata Title', source: 'openGraph' });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 101, {
      title: 'Metadata Title',
      memo: '',
    });
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('never calls URL metadata when the share already has a title', async () => {
    const pendingShare = makePendingShare({ initialTitle: 'Video title from EXTRA_SUBJECT' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(resolveUrlMetadata).not.toHaveBeenCalled();
  });

  it('still saves and acknowledges the share when URL metadata resolution fails', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 102, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(resolveUrlMetadata).mockRejectedValue(new ApiError('unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    warnSpy.mockRestore();
  });

  it('applies the resolved share title to the saved Item (same resolver/PUT the review flow uses)', async () => {
    const pendingShare = makePendingShare({ initialTitle: 'Video title from EXTRA_SUBJECT' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 42, {
      title: 'Video title from EXTRA_SUBJECT',
      memo: '',
    });
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('still acknowledges the share when the title PUT fails - the Item is already saved (best-effort title)', async () => {
    const pendingShare = makePendingShare({ initialTitle: 'A title' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(updateItemDetails).mockRejectedValue(new ApiError('unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    expect(NativeIncomingShare!.reportAttemptOutcome).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('never uses the raw shared URL as the Item title', async () => {
    const pendingShare = makePendingShare({ initialTitle: 'https://example.com/a' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('retrying after a failed save never creates a second Item (saveInboxEntry replays the same clientRequestId)', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockRejectedValueOnce(new ApiError('unavailable'));
    jest.mocked(saveInboxEntry).mockResolvedValueOnce({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });

    await task({ pendingShareId: pendingShare.id }); // first attempt fails
    await task({ pendingShareId: pendingShare.id }); // retry succeeds

    expect(saveInboxEntry).toHaveBeenCalledTimes(2);
    expect(saveInboxEntry).toHaveBeenNthCalledWith(1, expect.anything(), pendingShare.text, pendingShare.id);
    expect(saveInboxEntry).toHaveBeenNthCalledWith(2, expect.anything(), pendingShare.text, pendingShare.id);
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledTimes(1);
  });

  it('does not acknowledge the pending share when the save fails', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockRejectedValue(new ApiError('unavailable'));

    await task({ pendingShareId: pendingShare.id });

    expect(NativeIncomingShare!.acknowledgePendingShare).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.reportAttemptOutcome).toHaveBeenCalledWith(pendingShare.id, 'retryableFailure');
  });

  it('reports reviewRequired and never saves when the shared text is not an exact URL', async () => {
    const pendingShare = makePendingShare({ text: 'Check this out: https://example.com/a' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);

    await task({ pendingShareId: pendingShare.id });

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.reportAttemptOutcome).toHaveBeenCalledWith(pendingShare.id, 'reviewRequired');
  });

  it('checks URL safety for the shared URL and still acknowledges the share when a threat is detected', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });

    await task({ pendingShareId: pendingShare.id });

    expect(checkUrlSafety).toHaveBeenCalledWith(expect.anything(), pendingShare.text);
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('still saves and acknowledges the share when the URL safety check itself fails (never a hard dependency)', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 103, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(checkUrlSafety).mockRejectedValue(new ApiError('unavailable'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    warnSpy.mockRestore();
  });

  describe('privacy - diagnostic logging never leaks share content', () => {
    // Distinctive enough that a substring match below can only succeed if the real value leaked
    // into a log call, not by coincidence with some other logged field.
    const SECRET_PENDING_SHARE_ID = 'pending-share-id-should-never-be-logged-verbatim';
    const SECRET_URL =
      'https://example.com/shortslike/should-never-be-logged-verbatim?token=super-secret-query-value';

    /** Every arg of every console.log/warn call this test observed, flattened to one searchable string. */
    function allLoggedText(logSpy: jest.SpyInstance, warnSpy: jest.SpyInstance): string {
      const calls: unknown[][] = [...logSpy.mock.calls, ...warnSpy.mock.calls];
      return calls.map(call => call.map((arg: unknown) => JSON.stringify(arg)).join(' ')).join('\n');
    }

    it('never logs the resolved title text - only titleSource/resolvedTitlePresent', async () => {
      const SECRET_TITLE = 'secret-video-title-should-never-be-logged-verbatim';
      const pendingShare = makePendingShare({ initialTitle: SECRET_TITLE });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(updateItemDetails).mockRejectedValue(new Error(`rejected: ${SECRET_TITLE}`));
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await task({ pendingShareId: pendingShare.id });

      expect(allLoggedText(logSpy, warnSpy)).not.toContain(SECRET_TITLE);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('never logs the raw shared URL or the raw pendingShareId on a successful save', async () => {
      const pendingShare = makePendingShare({ id: SECRET_PENDING_SHARE_ID, text: SECRET_URL });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: SECRET_URL, savedAtUtc: '2026-01-01T00:00:00Z' });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await task({ pendingShareId: pendingShare.id });

      const logged = allLoggedText(logSpy, warnSpy);
      expect(logged).not.toContain(SECRET_URL);
      expect(logged).not.toContain(SECRET_PENDING_SHARE_ID);
      expect(logged).not.toContain('token=super-secret-query-value');
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('never logs the raw shared URL, raw pendingShareId, or raw error message on a failed save (only kind/status/outcome)', async () => {
      const pendingShare = makePendingShare({ id: SECRET_PENDING_SHARE_ID, text: SECRET_URL });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      const secretErrorMessage = 'server said: leaked-secret-detail-should-never-be-logged';
      jest.mocked(saveInboxEntry).mockRejectedValue(new Error(secretErrorMessage));
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await task({ pendingShareId: pendingShare.id });

      const logged = allLoggedText(logSpy, warnSpy);
      expect(logged).not.toContain(SECRET_URL);
      expect(logged).not.toContain(SECRET_PENDING_SHARE_ID);
      expect(logged).not.toContain(secretErrorMessage);
      // The failure-classification log itself must still have fired (this is the always-on,
      // privacy-safe part - see incomingShareHeadlessTask.ts).
      expect(warnSpy).toHaveBeenCalledWith(
        '[IncomingShareHeadlessTask] save failed',
        expect.objectContaining({ outcome: 'retryableFailure' }),
      );
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('never logs the raw shared URL when the safety check reports a threat or fails', async () => {
      const pendingShare = makePendingShare({ id: SECRET_PENDING_SHARE_ID, text: SECRET_URL });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 100, url: SECRET_URL, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(checkUrlSafety).mockResolvedValue({ status: 'threatDetected', threats: ['malware'] });
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await task({ pendingShareId: pendingShare.id });

      const logged = allLoggedText(logSpy, warnSpy);
      expect(logged).not.toContain(SECRET_URL);
      expect(logged).not.toContain(SECRET_PENDING_SHARE_ID);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('never logs the raw pendingShareId or raw queue contents when the pendingShareId is not found in the native queue', async () => {
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([]);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      await task({ pendingShareId: SECRET_PENDING_SHARE_ID });

      const logged = allLoggedText(logSpy, warnSpy);
      expect(logged).not.toContain(SECRET_PENDING_SHARE_ID);
      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
