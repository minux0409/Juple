import { AppRegistry } from 'react-native';
import { registerIncomingShareHeadlessTask } from '../incomingShareHeadlessTask';
import NativeIncomingShare from '../specs/NativeIncomingShare';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { setItemPreviewImage, submitInstagramMetadataCandidate, updateItemDetails } from '../../items/api/itemsApi';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';
import { fetchInstagramOpenGraphCandidate } from '../../urlMetadata/instagramOpenGraphFetch';
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
  setItemPreviewImage: jest.fn(),
  submitInstagramMetadataCandidate: jest.fn(),
}));

// The Instagram device fetch is never a real network request in tests.
jest.mock('../../urlMetadata/instagramOpenGraphFetch', () => ({
  ...jest.requireActual('../../urlMetadata/instagramOpenGraphFetch'),
  fetchInstagramOpenGraphCandidate: jest.fn(async () => ({ outcome: 'noMetadata', candidate: null })),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
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
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });
    jest.mocked(setItemPreviewImage).mockResolvedValue(undefined);
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

  it('Quick Save ON: an Instagram URL-only share gets the same metadata enrichment (title + real image) as the review flow', async () => {
    const instagramUrl = 'https://www.instagram.com/reel/ABC123xyz/?igsh=abc';
    const pendingShare = makePendingShare({ text: instagramUrl });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 150, url: instagramUrl, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'kkikki_ent on Instagram: "caption"',
      source: 'openGraph',
      previewImageUrl: 'https://scontent.cdninstagram.com/v/t51/real-post.jpg',
    });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), instagramUrl);
    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 150, { title: 'kkikki_ent on Instagram: "caption"', memo: '' });
    expect(setItemPreviewImage).toHaveBeenCalledWith(expect.anything(), 150, 'https://scontent.cdninstagram.com/v/t51/real-post.jpg');
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    // Backend metadata was complete - the device fallback never runs.
    expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
    expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
  });

  describe('Instagram device fallback', () => {
    const instagramUrl = 'https://www.instagram.com/p/ABC123xyz/?igsh=abc';
    const candidate = { ogTitle: 'someone on Instagram: "x"', ogImage: 'https://scontent.cdninstagram.com/v/a.jpg', ogUrl: null, ogDescription: null };

    beforeEach(() => {
      const pendingShare = makePendingShare({ text: instagramUrl });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 160, url: instagramUrl, savedAtUtc: '2026-01-01T00:00:00Z' });
    });

    it('when the Backend got nothing (login redirect), fetches the public page once after acknowledging and submits the raw candidate', async () => {
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
      jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 't', previewImageUrl: 'https://scontent.cdninstagram.com/v/a.jpg', applied: true });

      await task({ pendingShareId: 'share-1' });

      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledWith(instagramUrl);
      expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), 160, candidate);
      // Never through the user title-edit API: nothing to apply from the Backend, and the candidate
      // goes only to its own endpoint.
      expect(updateItemDetails).not.toHaveBeenCalled();
      const ackOrder = jest.mocked(NativeIncomingShare!.acknowledgePendingShare).mock.invocationCallOrder[0];
      expect(ackOrder).toBeLessThan(jest.mocked(fetchInstagramOpenGraphCandidate).mock.invocationCallOrder[0]);
    });

    it('also runs when only the image is missing', async () => {
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'backend title', source: 'openGraph', previewImageUrl: null });
      jest.mocked(updateItemDetails).mockResolvedValue(undefined);

      await task({ pendingShareId: 'share-1' });

      expect(fetchInstagramOpenGraphCandidate).toHaveBeenCalledTimes(1);
    });

    it('a device fetch failure is silent: no candidate is sent and the share is still acknowledged', async () => {
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'loginRedirect', candidate: null });

      await task({ pendingShareId: 'share-1' });

      expect(submitInstagramMetadataCandidate).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
      expect(NativeIncomingShare!.reportAttemptOutcome).not.toHaveBeenCalled();
    });

    it('a Backend rejection of the candidate is silent', async () => {
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
      jest.mocked(submitInstagramMetadataCandidate).mockRejectedValueOnce(new ApiError('badRequest', 400));

      await expect(task({ pendingShareId: 'share-1' })).resolves.toBeUndefined();
      expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith('share-1');
    });

    it('never runs for a non-Instagram URL, even with no Backend metadata', async () => {
      const pendingShare = makePendingShare({ text: 'https://example.com/a' });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);

      await task({ pendingShareId: pendingShare.id });

      expect(fetchInstagramOpenGraphCandidate).not.toHaveBeenCalled();
    });
  });

  it('applies a title resolved from URL metadata when the share itself had none', async () => {
    const pendingShare = makePendingShare();
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 101, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata Title', source: 'openGraph', previewImageUrl: null });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);

    await task({ pendingShareId: pendingShare.id });

    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 101, {
      title: 'Metadata Title',
      memo: '',
    });
    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
  });

  it('still resolves URL metadata for the preview image when the share already has a title, without overwriting the title', async () => {
    // This is the fix for a real bug: a share that already carries a title (e.g. YouTube's
    // EXTRA_SUBJECT) used to skip URL-metadata resolution entirely, silently losing the preview
    // image too even though the identical URL saved with no incoming title got one.
    const pendingShare = makePendingShare({ initialTitle: 'Video title from EXTRA_SUBJECT' });
    jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
    jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: pendingShare.text, savedAtUtc: '2026-01-01T00:00:00Z' });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'A Different Metadata Title',
      source: 'openGraph',
      previewImageUrl: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    });

    await task({ pendingShareId: pendingShare.id });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), pendingShare.text);
    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 42, {
      title: 'Video title from EXTRA_SUBJECT',
      memo: '',
    });
    expect(updateItemDetails).toHaveBeenCalledTimes(1);
    expect(setItemPreviewImage).toHaveBeenCalledWith(
      expect.anything(),
      42,
      'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    );
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

  describe('routing by payload shape (never by source app)', () => {
    it.each([
      ['a bare URL', 'https://example.com/a', 'https://example.com/a'],
      ['a 당근-style description + blank lines + URL', '당근에서 이 글을 확인해보세요!\n\nhttps://www.daangn.com/articles/1253314119?share=true', 'https://www.daangn.com/articles/1253314119?share=true'],
      ['one-line text + URL', 'Check this out: https://example.com/a', 'https://example.com/a'],
      ['multi-line text + URL', '첫 줄\n둘째 줄\nhttps://example.com/a', 'https://example.com/a'],
      ['a URL with a query string after text', '링크: https://example.com/a?x=1&y=2%20z', 'https://example.com/a?x=1&y=2%20z'],
      ['a YouTube title line + URL', 'Some Video\nhttps://www.youtube.com/watch?v=abc', 'https://www.youtube.com/watch?v=abc'],
      ['a URL padded with whitespace/newlines', '\n  https://example.com/a \n', 'https://example.com/a'],
    ])('saves immediately for %s - never reviewRequired', async (_label, text, url) => {
      const pendingShare = makePendingShare({ text });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 300, url, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(updateItemDetails).mockResolvedValue(undefined);

      await task({ pendingShareId: pendingShare.id });

      expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), url, pendingShare.id);
      expect(NativeIncomingShare!.reportAttemptOutcome).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    });


    it.each([
      ['no URL at all', 'just some text, no link'],
      ['more than one URL (ambiguous)', 'A https://example.com/a B https://example.com/b'],
      ['a URL whose end is uncertain (a word glued onto it)', '문구 https://a.com/x에서 확인'],
    ])('reports reviewRequired and never saves for %s', async (_label, text) => {
      const pendingShare = makePendingShare({ text });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);

      await task({ pendingShareId: pendingShare.id });

      expect(saveInboxEntry).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.acknowledgePendingShare).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.reportAttemptOutcome).toHaveBeenCalledWith(pendingShare.id, 'reviewRequired');
    });
  });

  describe('title precedence - share text around the URL is never saved as the title', () => {
    const DAANGN_TEXT = '당근에서 이 글을 확인해보세요!\n\nhttps://www.daangn.com/articles/1253314119?share=true';
    const DAANGN_URL = 'https://www.daangn.com/articles/1253314119?share=true';
    const SHARE_TEXT_TITLE = '당근에서 이 글을 확인해보세요!';

    function titlesWritten(): unknown[] {
      return jest.mocked(updateItemDetails).mock.calls.map(call => call[2].title);
    }

    beforeEach(() => {
      jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    });

    it('description + URL: saves the URL (query kept) and applies the real page metadata title, never the share text', async () => {
      const pendingShare = makePendingShare({ text: DAANGN_TEXT });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 310, url: DAANGN_URL, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(resolveUrlMetadata).mockResolvedValue({
        title: 'Real page title | Category | Site', source: 'openGraph', previewImageUrl: 'https://img.example.com/p.jpg',
      });

      await task({ pendingShareId: pendingShare.id });

      expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), DAANGN_URL, pendingShare.id);
      expect(titlesWritten()).toEqual(['Real page title | Category | Site']);
      expect(titlesWritten()).not.toContain(SHARE_TEXT_TITLE);
      expect(setItemPreviewImage).toHaveBeenCalledWith(expect.anything(), 310, 'https://img.example.com/p.jpg');
      expect(NativeIncomingShare!.reportAttemptOutcome).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    });

    it('description + URL with no metadata title: still saved and acknowledged, title left empty (hostname fallback) - never the share text', async () => {
      const pendingShare = makePendingShare({ text: DAANGN_TEXT });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 311, url: DAANGN_URL, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));

      await task({ pendingShareId: pendingShare.id });

      expect(updateItemDetails).not.toHaveBeenCalled();
      expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(pendingShare.id);
    });

    it('a structured share title (EXTRA_SUBJECT/EXTRA_TITLE) is still saved as-is, even alongside mixed text, and metadata never overwrites it', async () => {
      const pendingShare = makePendingShare({ text: 'Watch this\nhttps://www.youtube.com/watch?v=abc', initialTitle: 'Structured Video Title' });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 312, url: 'https://www.youtube.com/watch?v=abc', savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata title', source: 'openGraph', previewImageUrl: null });

      await task({ pendingShareId: pendingShare.id });

      expect(titlesWritten()).toEqual(['Structured Video Title']);
    });

    it('a bare URL with no structured title gets the metadata title (unchanged)', async () => {
      const pendingShare = makePendingShare({ text: 'https://example.com/a' });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 313, url: 'https://example.com/a', savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata title', source: 'openGraph', previewImageUrl: null });

      await task({ pendingShareId: pendingShare.id });

      expect(titlesWritten()).toEqual(['Metadata title']);
    });

    it('an Instagram caption + URL share with no Backend title still reaches the device fallback (the caption is not a title)', async () => {
      const instagramUrl = 'https://www.instagram.com/p/ABC123xyz/';
      const candidate = { ogTitle: 'someone on Instagram: "x"', ogImage: 'https://scontent.cdninstagram.com/v/a.jpg', ogUrl: null, ogDescription: null };
      const pendingShare = makePendingShare({ text: `Look at this post ${instagramUrl}` });
      jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([pendingShare]);
      jest.mocked(saveInboxEntry).mockResolvedValue({ id: 314, url: instagramUrl, savedAtUtc: '2026-01-01T00:00:00Z' });
      jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: 'https://scontent.cdninstagram.com/v/a.jpg' });
      jest.mocked(fetchInstagramOpenGraphCandidate).mockResolvedValueOnce({ outcome: 'candidate', candidate });
      jest.mocked(submitInstagramMetadataCandidate).mockResolvedValueOnce({ title: 't', previewImageUrl: candidate.ogImage, applied: true });

      await task({ pendingShareId: pendingShare.id });

      expect(updateItemDetails).not.toHaveBeenCalled();
      expect(submitInstagramMetadataCandidate).toHaveBeenCalledWith(expect.anything(), 314, candidate);
    });
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
