import ReactTestRenderer, { act } from 'react-test-renderer';
import { IncomingShareRouter } from '../IncomingShareRouter';
import { useIncomingShare } from '../useIncomingShare';
import { navigationRef } from '../../navigation/navigationRef';

jest.mock('../useIncomingShare', () => ({
  useIncomingShare: jest.fn(),
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
  afterEach(() => {
    jest.clearAllMocks();
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
});
