import ReactTestRenderer, { act } from 'react-test-renderer';
import {
  addItemComment,
  deleteItemComment,
  getCommentReplies,
  getItemComments,
  setCommentLike,
  type CommentReplyPage,
  type ItemComment,
  type ItemCommentPage,
} from '../commentsApi';
import { useItemComments } from '../useItemComments';

jest.mock('../commentsApi', () => ({
  ...jest.requireActual('../commentsApi'),
  getItemComments: jest.fn(),
  getCommentReplies: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
  setCommentLike: jest.fn(),
}));

type Api = ReturnType<typeof useItemComments>;
const stableRequest = jest.fn() as never;

const author = { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: true };
const top = (id: number, overrides: Partial<ItemComment> = {}): ItemComment => ({
  id,
  body: `c${id}`,
  createdAtUtc: '2026-10-01T00:00:00Z',
  author,
  replyCount: 0,
  likeCount: 0,
  viewerLiked: false,
  ...overrides,
});
const reply = (id: number, rootCommentId: number, overrides: Partial<ItemComment> = {}): ItemComment =>
  top(id, { rootCommentId, parentCommentId: rootCommentId, ...overrides });
const page = (items: ItemComment[], previousCursor: number | null = null, totalCount = items.length): ItemCommentPage => ({ items, previousCursor, totalCount });
const replyPage = (items: ItemComment[], nextCursor: number | null = null, totalCount = items.length): CommentReplyPage => ({ items, nextCursor, totalCount });

async function renderHook(options: { focusThreadRootId?: number | null } = {}) {
  const onFailure = jest.fn();
  const holder: { api?: Api } = {};
  function Harness() {
    holder.api = useItemComments(stableRequest, 5, 7, () => 'grant', onFailure, true, options.focusThreadRootId ?? null);
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

describe('useItemComments - replies', () => {
  it('loads no replies up front: only the top-level page, each row carrying its reply count', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 3 }), top(2)]));

    const { holder } = await renderHook();

    expect(getCommentReplies).not.toHaveBeenCalled();
    expect(holder.api!.comments.map(entry => entry.replyCount)).toEqual([3, 0]);
    expect(holder.api!.threads).toEqual({});
  });

  it('opening a thread loads its first page once; hiding and showing it again reuses what is loaded', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 2 })]));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1), reply(11, 1)]));
    const { holder } = await renderHook();

    await act(async () => holder.api!.toggleReplies(1));

    expect(getCommentReplies).toHaveBeenCalledTimes(1);
    expect(getCommentReplies).toHaveBeenCalledWith(expect.anything(), 5, 7, 1, { unlockToken: 'grant' });
    expect(holder.api!.threads[1]).toEqual(expect.objectContaining({ expanded: true, status: 'ready', nextCursor: null }));
    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10, 11]);

    await act(async () => holder.api!.toggleReplies(1));
    expect(holder.api!.threads[1].expanded).toBe(false);
    expect(holder.api!.threads[1].replies).toHaveLength(2);
    await act(async () => holder.api!.toggleReplies(1));
    expect(holder.api!.threads[1].expanded).toBe(true);
    expect(getCommentReplies).toHaveBeenCalledTimes(1);
  });

  it('more replies are appended after the cursor - never duplicated', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 3 })]));
    jest.mocked(getCommentReplies)
      .mockResolvedValueOnce(replyPage([reply(10, 1), reply(11, 1)], 11, 3))
      .mockResolvedValueOnce(replyPage([reply(11, 1), reply(12, 1)], null, 3));
    const { holder } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.loadMoreReplies(1);
    });

    expect(getCommentReplies).toHaveBeenLastCalledWith(expect.anything(), 5, 7, 1, { after: 11, unlockToken: 'grant' });
    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10, 11, 12]);
    expect(holder.api!.threads[1].nextCursor).toBeNull();
    // Nothing left: asking again does nothing.
    await act(async () => {
      await holder.api!.loadMoreReplies(1);
    });
    expect(getCommentReplies).toHaveBeenCalledTimes(2);
  });

  it('a failed later reply page keeps the replies already shown and offers a retry - no toast, no reload of the comments', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 3 })]));
    jest.mocked(getCommentReplies)
      .mockResolvedValueOnce(replyPage([reply(10, 1), reply(11, 1)], 11, 3))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(replyPage([reply(12, 1)], null, 3));
    const { holder, onFailure } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.loadMoreReplies(1);
    });

    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10, 11]);
    expect(holder.api!.threads[1]).toEqual(expect.objectContaining({ moreFailed: true, isLoadingMore: false, status: 'ready' }));
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1]);
    expect(onFailure).not.toHaveBeenCalled();

    await act(async () => {
      await holder.api!.loadMoreReplies(1);
    });
    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10, 11, 12]);
    expect(holder.api!.threads[1].moreFailed).toBe(false);
  });

  it('a failed FIRST reply page is an error in that thread only - the comments stay - and it can be retried', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 }), top(2)]));
    jest.mocked(getCommentReplies).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(replyPage([reply(10, 1)]));
    const { holder } = await renderHook();

    await act(async () => holder.api!.toggleReplies(1));
    expect(holder.api!.threads[1]).toEqual(expect.objectContaining({ expanded: true, status: 'error' }));
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1, 2]);
    expect(holder.api!.status).toBe('ready');

    await act(async () => holder.api!.retryReplies(1));
    expect(holder.api!.threads[1].status).toBe('ready');
    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10]);
  });
});

describe('useItemComments - answering', () => {
  it('answering a top-level comment targets it (no mention); answering a reply targets that reply and mentions its author', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 })]));
    const { holder } = await renderHook();

    act(() => holder.api!.startReply(top(1)));
    expect(holder.api!.replyTarget).toEqual({ commentId: 1, rootCommentId: 1, name: '민욱', mention: null });

    act(() => holder.api!.startReply(reply(10, 1)));
    expect(holder.api!.replyTarget).toEqual({ commentId: 10, rootCommentId: 1, name: '민욱', mention: '@민욱' });

    act(() => holder.api!.cancelReply());
    expect(holder.api!.replyTarget).toBeNull();
    // A deleted placeholder cannot be answered.
    act(() => holder.api!.startReply(top(2, { isDeleted: true })));
    expect(holder.api!.replyTarget).toBeNull();
  });

  it('a reply is sent with only the answered comment\'s id, lands in its thread (which opens), counts, and ends reply mode', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 })], null, 2));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1)]));
    jest.mocked(addItemComment).mockResolvedValue(reply(11, 1, { parentCommentId: 10, body: '@민욱 hi' }));
    const { holder } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));
    act(() => holder.api!.startReply(reply(10, 1)));

    let sent = false;
    await act(async () => {
      sent = await holder.api!.send('@민욱 hi');
    });

    expect(sent).toBe(true);
    expect(addItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, '@민욱 hi', 'grant', 10);
    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10, 11]);
    expect(holder.api!.comments[0].replyCount).toBe(2);
    expect(holder.api!.totalCount).toBe(3);
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1]); // a reply is never a top-level row
    expect(holder.api!.replyTarget).toBeNull();
  });

  it('a reply to a thread that was never opened opens it and loads its replies', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 })]));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1), reply(11, 1)]));
    jest.mocked(addItemComment).mockResolvedValue(reply(11, 1));
    const { holder } = await renderHook();
    act(() => holder.api!.startReply(top(1)));

    await act(async () => {
      await holder.api!.send('first answer');
    });

    expect(holder.api!.threads[1]).toEqual(expect.objectContaining({ expanded: true, status: 'ready' }));
    expect(getCommentReplies).toHaveBeenCalledTimes(1);
  });

  it('a failed reply keeps reply mode (and so the text and the target) and reports the send', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1)]));
    jest.mocked(addItemComment).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = await renderHook();
    act(() => holder.api!.startReply(top(1)));

    let sent = true;
    await act(async () => {
      sent = await holder.api!.send('answer');
    });

    expect(sent).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('send');
    expect(holder.api!.replyTarget).toEqual(expect.objectContaining({ commentId: 1 }));
    expect(holder.api!.comments[0].replyCount).toBe(0);
  });

  it('with no reply target the comment is a top-level one (no parent is sent)', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1)]));
    jest.mocked(addItemComment).mockResolvedValue(top(2, { body: 'plain' }));
    const { holder } = await renderHook();

    await act(async () => {
      await holder.api!.send('plain');
    });

    expect(addItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 'plain', 'grant');
    expect(holder.api!.comments.map(entry => entry.id)).toEqual([1, 2]);
  });
});

describe('useItemComments - hearts', () => {
  it('flips the heart at once, then takes the server\'s answer', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { likeCount: 2 })]));
    const answer = deferred<{ liked: boolean; likeCount: number }>();
    jest.mocked(setCommentLike).mockReturnValue(answer.promise);
    const { holder } = await renderHook();

    let pending!: Promise<void>;
    act(() => {
      pending = holder.api!.toggleLike(holder.api!.comments[0]);
    });
    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ viewerLiked: true, likeCount: 3 }));
    expect(setCommentLike).toHaveBeenCalledWith(expect.anything(), 5, 7, 1, true, 'grant');

    await act(async () => {
      answer.resolve({ liked: true, likeCount: 5 }); // somebody else hearted meanwhile
      await pending;
    });
    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ viewerLiked: true, likeCount: 5 }));
  });

  it('a second tap while the first is on its way is ignored; a later tap un-hearts', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1)]));
    const answer = deferred<{ liked: boolean; likeCount: number }>();
    jest.mocked(setCommentLike).mockReturnValueOnce(answer.promise).mockResolvedValueOnce({ liked: false, likeCount: 0 });
    const { holder } = await renderHook();

    let first!: Promise<void>;
    act(() => {
      first = holder.api!.toggleLike(holder.api!.comments[0]);
    });
    await act(async () => {
      await holder.api!.toggleLike(holder.api!.comments[0]);
    });
    expect(setCommentLike).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve({ liked: true, likeCount: 1 });
      await first;
    });
    await act(async () => {
      await holder.api!.toggleLike(holder.api!.comments[0]);
    });
    expect(setCommentLike).toHaveBeenLastCalledWith(expect.anything(), 5, 7, 1, false, 'grant');
    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ viewerLiked: false, likeCount: 0 }));
  });

  it('a failed heart flips back and is reported', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { likeCount: 4, viewerLiked: true })]));
    jest.mocked(setCommentLike).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = await renderHook();

    await act(async () => {
      await holder.api!.toggleLike(holder.api!.comments[0]);
    });

    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ viewerLiked: true, likeCount: 4 }));
    expect(onFailure).toHaveBeenCalledWith('like');
  });

  it('hearts a reply inside its thread', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 })]));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1)]));
    jest.mocked(setCommentLike).mockResolvedValue({ liked: true, likeCount: 1 });
    const { holder } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.toggleLike(holder.api!.threads[1].replies[0]);
    });

    expect(holder.api!.threads[1].replies[0]).toEqual(expect.objectContaining({ viewerLiked: true, likeCount: 1 }));
    expect(holder.api!.comments[0].viewerLiked).toBe(false);
  });

  it('a deleted placeholder cannot be hearted', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { isDeleted: true, body: '' })]));
    const { holder } = await renderHook();

    await act(async () => {
      await holder.api!.toggleLike(holder.api!.comments[0]);
    });

    expect(setCommentLike).not.toHaveBeenCalled();
  });
});

describe('useItemComments - deleting inside threads', () => {
  it('a comment that has replies stays as a "deleted" placeholder with its replies; the count still goes down', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1, likeCount: 2, viewerLiked: true })], null, 2));
    jest.mocked(deleteItemComment).mockResolvedValue(undefined);
    const { holder } = await renderHook();

    await act(async () => {
      await holder.api!.remove(1);
    });

    expect(holder.api!.comments).toHaveLength(1);
    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ id: 1, isDeleted: true, body: '', likeCount: 0, viewerLiked: false, replyCount: 1 }));
    expect(holder.api!.totalCount).toBe(1);
  });

  it('removing a reply nobody answered drops it and lowers the thread\'s reply count', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 2 })], null, 3));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1), reply(11, 1)]));
    jest.mocked(deleteItemComment).mockResolvedValue(undefined);
    const { holder } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.remove(11);
    });

    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10]);
    expect(holder.api!.comments[0].replyCount).toBe(1);
    expect(holder.api!.totalCount).toBe(2);
  });

  it('removing the last reply also removes the placeholders it was keeping alive, up the chain', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 2, isDeleted: true, body: '' })], null, 1));
    jest.mocked(getCommentReplies).mockResolvedValue(
      replyPage([reply(10, 1, { isDeleted: true, body: '' }), reply(11, 1, { parentCommentId: 10 })]),
    );
    jest.mocked(deleteItemComment).mockResolvedValue(undefined);
    const { holder } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.remove(11);
    });

    expect(holder.api!.comments).toEqual([]); // the whole finished thread is gone
    expect(holder.api!.threads[1]).toBeUndefined();
  });

  it('a failed delete puts the comment, the thread and the count back', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1, { replyCount: 1 })], null, 2));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 1)]));
    jest.mocked(deleteItemComment).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = await renderHook();
    await act(async () => holder.api!.toggleReplies(1));

    await act(async () => {
      await holder.api!.remove(10);
    });

    expect(holder.api!.threads[1].replies.map(entry => entry.id)).toEqual([10]);
    expect(holder.api!.comments[0].replyCount).toBe(1);
    expect(holder.api!.totalCount).toBe(2);
    expect(onFailure).toHaveBeenCalledWith('delete');
  });
});

describe('useItemComments - opening a notification\'s thread', () => {
  it('opens the thread of the focused root once its comments are here', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(1), top(2, { replyCount: 1 })]));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(10, 2)]));

    const { holder } = await renderHook({ focusThreadRootId: 2 });

    expect(holder.api!.threads[2]).toEqual(expect.objectContaining({ expanded: true, status: 'ready' }));
    expect(getCommentReplies).toHaveBeenCalledTimes(1);
    expect(holder.api!.threads[1]).toBeUndefined();
  });

  it('walks back through older pages to find a root that is not among the newest', async () => {
    jest.mocked(getItemComments)
      .mockResolvedValueOnce(page([top(8), top(9)], 8, 9))
      .mockResolvedValueOnce(page([top(3, { replyCount: 1 }), top(4)], null, 9));
    jest.mocked(getCommentReplies).mockResolvedValue(replyPage([reply(40, 3)]));

    const { holder } = await renderHook({ focusThreadRootId: 3 });

    expect(getItemComments).toHaveBeenCalledTimes(2);
    expect(holder.api!.threads[3]).toEqual(expect.objectContaining({ expanded: true }));
  });

  it('does nothing for a thread that no longer exists, and does not keep paging for ever', async () => {
    jest.mocked(getItemComments).mockResolvedValue(page([top(8)], null, 1));

    const { holder } = await renderHook({ focusThreadRootId: 99 });

    expect(holder.api!.threads).toEqual({});
    expect(getCommentReplies).not.toHaveBeenCalled();
    expect(getItemComments).toHaveBeenCalledTimes(1);
  });
});
