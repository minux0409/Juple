import ReactTestRenderer, { act } from 'react-test-renderer';
import { addItemComment, deleteItemComment, getItemComments, type ItemComment, type ItemCommentPage } from '../commentsApi';
import { useItemComments } from '../useItemComments';

jest.mock('../commentsApi', () => ({
  ...jest.requireActual('../commentsApi'),
  getItemComments: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
}));

type Api = ReturnType<typeof useItemComments>;
// The real request function is stable across renders (useAuthenticatedApi); so is this one.
const stableRequest = jest.fn() as never;

const author = { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: true };
const comment = (id: number, body = `c${id}`): ItemComment => ({ id, body, createdAtUtc: '2026-10-01T00:00:00Z', author });
const page = (ids: number[], previousCursor: number | null, totalCount = ids.length): ItemCommentPage => ({ items: ids.map(id => comment(id)), previousCursor, totalCount });

async function renderHook(onFailure = jest.fn()) {
  const holder: { api?: Api } = {};
  function Harness() {
    holder.api = useItemComments(stableRequest, 5, 7, () => 'grant', onFailure);
    return null;
  }
  await act(async () => {
    ReactTestRenderer.create(<Harness />);
  });
  return { holder, onFailure };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => jest.clearAllMocks());

describe('useItemComments', () => {
  it('opens with the newest page (oldest first), its total and whether older ones exist', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([8, 9, 10], 8, 10));

    const { holder } = await renderHook();

    expect(getItemComments).toHaveBeenCalledWith(expect.anything(), 5, 7, { unlockToken: 'grant' });
    expect(holder.api!.status).toBe('ready');
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([8, 9, 10]);
    expect(holder.api!.totalCount).toBe(10);
    expect(holder.api!.hasPrevious).toBe(true);
  });

  it('a failed first load is an error state in this list only, and load() tries again', async () => {
    jest.mocked(getItemComments).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([1], null));
    const { holder } = await renderHook();
    expect(holder.api!.status).toBe('error');

    await act(async () => {
      await holder.api!.load();
    });

    expect(holder.api!.status).toBe('ready');
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1]);
  });

  it('older comments are prepended - never duplicated - and the cursor moves back', async () => {
    jest.mocked(getItemComments)
      .mockResolvedValueOnce(page([8, 9, 10], 8, 10))
      .mockResolvedValueOnce(page([5, 6, 7, 8], 5, 10));
    const { holder } = await renderHook();

    await act(async () => {
      await holder.api!.loadPrevious();
    });

    expect(getItemComments).toHaveBeenLastCalledWith(expect.anything(), 5, 7, { before: 8, unlockToken: 'grant' });
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(holder.api!.hasPrevious).toBe(true);
  });

  it('the last older page ends the list; loadPrevious with nothing older does nothing', async () => {
    jest.mocked(getItemComments).mockResolvedValueOnce(page([3, 4], 3, 4)).mockResolvedValueOnce(page([1, 2], null, 4));
    const { holder } = await renderHook();

    await act(async () => {
      await holder.api!.loadPrevious();
    });
    expect(holder.api!.hasPrevious).toBe(false);
    await act(async () => {
      await holder.api!.loadPrevious();
    });

    expect(getItemComments).toHaveBeenCalledTimes(2);
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it('a second "이전 댓글 보기" while one is loading is ignored', async () => {
    const older = deferred<ItemCommentPage>();
    jest.mocked(getItemComments).mockResolvedValueOnce(page([8], 8, 9)).mockReturnValueOnce(older.promise);
    const { holder } = await renderHook();

    let first!: Promise<void>;
    act(() => {
      first = holder.api!.loadPrevious();
      holder.api!.loadPrevious().catch(() => undefined);
    });
    expect(getItemComments).toHaveBeenCalledTimes(2);
    expect(holder.api!.isLoadingPrevious).toBe(true);
    await act(async () => {
      older.resolve(page([7], null, 9));
      await first;
    });

    expect(holder.api!.comments.map(entry => entry.id)).toEqual([7, 8]);
  });

  it('send: the server\'s comment is appended, the count goes up, and it returns true', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([1, 2], null, 2));
    jest.mocked(addItemComment).mockResolvedValue(comment(3, 'new one'));
    const { holder } = await renderHook();

    let sent = false;
    await act(async () => {
      sent = await holder.api!.send('new one');
    });

    expect(sent).toBe(true);
    expect(addItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 'new one', 'grant');
    expect(holder.api!.comments.map(entry => entry.body)).toEqual(['c1', 'c2', 'new one']);
    expect(holder.api!.totalCount).toBe(3);
    // Only the comments changed: the page was not read again.
    expect(getItemComments).toHaveBeenCalledTimes(1);
  });

  it('a failed send changes nothing and reports it (the composer keeps its text)', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([1], null, 1));
    jest.mocked(addItemComment).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = await renderHook();

    let sent = true;
    await act(async () => {
      sent = await holder.api!.send('text');
    });

    expect(sent).toBe(false);
    expect(holder.api!.comments).toHaveLength(1);
    expect(holder.api!.totalCount).toBe(1);
    expect(onFailure).toHaveBeenCalledWith('send');
  });

  it('a second send while the first is on its way is ignored - never two comments from one tap', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([], null, 0));
    const pending = deferred<ItemComment>();
    jest.mocked(addItemComment).mockReturnValue(pending.promise);
    const { holder } = await renderHook();

    let first!: Promise<boolean>;
    let second = true;
    await act(async () => {
      first = holder.api!.send('once');
      second = await holder.api!.send('once');
    });
    expect(second).toBe(false);
    expect(holder.api!.isSending).toBe(true);
    await act(async () => {
      pending.resolve(comment(1, 'once'));
      await first;
    });

    expect(addItemComment).toHaveBeenCalledTimes(1);
    expect(holder.api!.comments).toHaveLength(1);
    expect(holder.api!.isSending).toBe(false);
  });

  it('remove: the row goes and the count drops at once; the server is asked once', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([1, 2, 3], null, 3));
    const pending = deferred<void>();
    jest.mocked(deleteItemComment).mockReturnValue(pending.promise);
    const { holder } = await renderHook();

    let done!: Promise<void>;
    act(() => {
      done = holder.api!.remove(2);
      holder.api!.remove(2).catch(() => undefined);
    });
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1, 3]);
    expect(holder.api!.totalCount).toBe(2);
    await act(async () => {
      pending.resolve();
      await done;
    });

    expect(deleteItemComment).toHaveBeenCalledTimes(1);
    expect(deleteItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 2, 'grant');
    expect(holder.api!.totalCount).toBe(2);
  });

  it('a failed delete puts the comment back in its place and the count back', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([1, 2, 3], null, 3));
    jest.mocked(deleteItemComment).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = await renderHook();

    await act(async () => {
      await holder.api!.remove(2);
    });

    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1, 2, 3]);
    expect(holder.api!.totalCount).toBe(3);
    expect(onFailure).toHaveBeenCalledWith('delete');
  });

  it('a failed older page is reported and keeps what is loaded', async () => {
    jest.mocked(getItemComments).mockResolvedValueOnce(page([8], 8, 9)).mockRejectedValueOnce(new Error('offline'));
    const { holder, onFailure } = await renderHook();

    await act(async () => {
      await holder.api!.loadPrevious();
    });

    expect(onFailure).toHaveBeenCalledWith('older');
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([8]);
    expect(holder.api!.hasPrevious).toBe(true);
  });
});
