import ReactTestRenderer, { act } from 'react-test-renderer';
import { IncomingShareRouter } from '../IncomingShareRouter';
import { useIncomingShare } from '../useIncomingShare';
import { getActiveNewLinkReviewDraft } from '../activeNewLinkReviewDraft';
import { navigationRef } from '../../navigation/navigationRef';
import i18n from '../../i18n';
import { validateClaimedDestination } from '../resolveShareDestination';

jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
// The shared decision is unit-tested in resolveShareDestination.test.ts; here only what the router does with it.
jest.mock('../resolveShareDestination', () => ({ validateClaimedDestination: jest.fn() }));

// A build with the Dev public web host: a Collection share link on it is a Collection, never a saved link.
jest.mock('../../config/publicWebConfig', () => ({ publicWebConfig: { host: 'dev.juple.co.kr' } }));

jest.mock('../useIncomingShare', () => ({
  useIncomingShare: jest.fn(),
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

function mockPendingShare(pendingShare: ReturnType<typeof makePendingShare> | null) {
  jest.mocked(useIncomingShare).mockReturnValue({
    pendingShare,
    acknowledgePendingShare: jest.fn().mockResolvedValue(undefined),
  });
}

async function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<IncomingShareRouter />);
  });
  return renderer;
}

describe('IncomingShareRouter', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  beforeEach(() => {
    jest.mocked(validateClaimedDestination).mockImplementation(async (_request, id) => ({ collectionId: id, unavailable: false }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('a Juple Collection share link opens the Collection - never NewLinkReview, never an open-draft conflict - and consumes the share', async () => {
    const share = makePendingShare({ id: 'share-collection', text: '컬렉션 공유\nhttps://dev.juple.co.kr/c/AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123' });
    mockPendingShare(share);
    jest.mocked(getActiveNewLinkReviewDraft).mockReturnValue({ getNormalizedUrl: () => 'https://other.test/', onConflictingShare: jest.fn() } as never);
    const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
    expect(navigationRef.navigate).toHaveBeenCalledWith('SharedCollection', { publicId: 'AbCdEfGh_ijkLMNOpqrSTUV-wxyz0123' });
    expect(acknowledgePendingShare).toHaveBeenCalledWith('share-collection');
    jest.mocked(getActiveNewLinkReviewDraft).mockReturnValue(null);
  });

  it('does not navigate when there is no pending share', async () => {
    mockPendingShare(null);
    await render();

    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });

  it('navigates to NewLinkReview with the parsed url/title/category and acknowledges the share', async () => {
    const share = makePendingShare({
      id: 'share-2',
      text: 'https://example.com/b',
      initialTitle: 'From intent',
      preselectedCollectionId: 7,
    });
    mockPendingShare(share);
    const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', {
      url: 'https://example.com/b',
      initialTitle: 'From intent',
      preselectedCollectionId: 7,
    });
    expect(acknowledgePendingShare).toHaveBeenCalledWith('share-2');
  });

  it('prefers a Quick Save composer draft title/category over the original intent values', async () => {
    mockPendingShare(
      makePendingShare({
        id: 'share-3',
        initialTitle: 'Original',
        preselectedCollectionId: 1,
        draftTitle: 'Edited in composer',
        draftCollectionId: 9,
      }),
    );

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'NewLinkReview',
      expect.objectContaining({ initialTitle: 'Edited in composer', preselectedCollectionId: 9 }),
    );
  });

  describe('a Collection named by a Direct Share row is re-validated before the review preselects it', () => {
    it('usable: preselected, and the share is consumed', async () => {
      mockPendingShare(makePendingShare({ id: 'share-d1', preselectedCollectionId: 7 }));
      const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();

      const renderer = await render();

      expect(validateClaimedDestination).toHaveBeenCalledWith(expect.anything(), 7);
      expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ preselectedCollectionId: 7 }));
      expect(acknowledgePendingShare).toHaveBeenCalledWith('share-d1');
      expect(renderer.root.findAll(node => typeof node.props.onConfirm === 'function')).toHaveLength(0);
    });

    it('no longer usable (deleted, locked, view-only): the review opens WITHOUT it, the link is kept, and a message says why', async () => {
      jest.mocked(validateClaimedDestination).mockResolvedValue({ collectionId: null, unavailable: true });
      mockPendingShare(makePendingShare({ id: 'share-d2', text: 'https://youtu.be/abc?si=xyz', preselectedCollectionId: 7 }));
      const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();

      const renderer = await render();

      expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', {
        url: 'https://youtu.be/abc?si=xyz',
        initialTitle: null,
        preselectedCollectionId: null,
      });
      expect(acknowledgePendingShare).toHaveBeenCalledWith('share-d2');
      const dialog = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0];
      expect(dialog.props.message).toBe(i18n.t('collections.shortcutUnavailable'));
    });

    it('the check itself failing (offline) keeps the claim - the review own save is verified by the server anyway', async () => {
      jest.mocked(validateClaimedDestination).mockResolvedValue({ collectionId: 7, unavailable: false });
      mockPendingShare(makePendingShare({ id: 'share-d3', preselectedCollectionId: 7 }));

      await render();

      expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ preselectedCollectionId: 7 }));
    });

    it('a share without a Collection never asks the backend about one', async () => {
      mockPendingShare(makePendingShare({ id: 'share-d4' }));

      await render();

      expect(validateClaimedDestination).not.toHaveBeenCalled();
      expect(navigationRef.navigate).toHaveBeenCalledWith('NewLinkReview', expect.objectContaining({ preselectedCollectionId: null }));
    });
  });

  it('extracts a title candidate from leading text before a single URL when no other title is available', async () => {
    mockPendingShare(
      makePendingShare({ id: 'share-4', text: 'Check this out: https://example.com/c' }),
    );

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'NewLinkReview',
      expect.objectContaining({ initialTitle: 'Check this out:' }),
    );
  });

  it('prefers the intent title (EXTRA_SUBJECT/EXTRA_TITLE) over a shared-text leading candidate', async () => {
    mockPendingShare(
      makePendingShare({
        id: 'share-4b',
        text: 'Check this out: https://example.com/c',
        initialTitle: 'From intent',
      }),
    );

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'NewLinkReview',
      expect.objectContaining({ initialTitle: 'From intent' }),
    );
  });

  it('passes a null title instead of the raw URL for a URL-only share', async () => {
    mockPendingShare(
      makePendingShare({ id: 'share-4c', text: 'https://www.instagram.com/reel/abc/' }),
    );

    await render();

    expect(navigationRef.navigate).toHaveBeenCalledWith(
      'NewLinkReview',
      expect.objectContaining({ initialTitle: null, url: 'https://www.instagram.com/reel/abc/' }),
    );
  });

  it('does not navigate again for the same pending share id on a later render', async () => {
    const share = makePendingShare({ id: 'share-5' });
    mockPendingShare(share);
    const renderer = await render();

    await act(async () => {
      renderer.update(<IncomingShareRouter />);
    });

    expect(navigationRef.navigate).toHaveBeenCalledTimes(1);
  });

  it('navigates again when a different pending share id appears', async () => {
    mockPendingShare(makePendingShare({ id: 'share-6' }));
    const renderer = await render();

    mockPendingShare(makePendingShare({ id: 'share-7' }));
    await act(async () => {
      renderer.update(<IncomingShareRouter />);
    });

    expect(navigationRef.navigate).toHaveBeenCalledTimes(2);
  });

  describe('when a NewLinkReview draft is already active', () => {
    it('hands a different-URL share off to the draft instead of navigating/acknowledging it itself', async () => {
      const share = makePendingShare({ id: 'share-8', text: 'https://example.com/new' });
      mockPendingShare(share);
      const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();
      const onConflictingShare = jest.fn();
      jest.mocked(getActiveNewLinkReviewDraft).mockReturnValue({
        getNormalizedUrl: () => 'https://example.com/current-draft',
        onConflictingShare,
      });

      await render();

      expect(onConflictingShare).toHaveBeenCalledWith(share);
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(acknowledgePendingShare).not.toHaveBeenCalled();
    });

    it('silently acknowledges - without a conflict hand-off or navigation - a share for the same URL the draft is already reviewing', async () => {
      const share = makePendingShare({ id: 'share-9', text: 'https://example.com/same' });
      mockPendingShare(share);
      const { acknowledgePendingShare } = jest.mocked(useIncomingShare)();
      const onConflictingShare = jest.fn();
      jest.mocked(getActiveNewLinkReviewDraft).mockReturnValue({
        getNormalizedUrl: () => 'https://example.com/same',
        onConflictingShare,
      });

      await render();

      expect(onConflictingShare).not.toHaveBeenCalled();
      expect(navigationRef.navigate).not.toHaveBeenCalled();
      expect(acknowledgePendingShare).toHaveBeenCalledWith('share-9');
    });

    it('does not hand off the same share id again on a later render', async () => {
      const share = makePendingShare({ id: 'share-10', text: 'https://example.com/new-2' });
      mockPendingShare(share);
      const onConflictingShare = jest.fn();
      jest.mocked(getActiveNewLinkReviewDraft).mockReturnValue({
        getNormalizedUrl: () => 'https://example.com/current-draft-2',
        onConflictingShare,
      });
      const renderer = await render();

      await act(async () => {
        renderer.update(<IncomingShareRouter />);
      });

      expect(onConflictingShare).toHaveBeenCalledTimes(1);
    });
  });
});
