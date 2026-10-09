import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { HeartIcon } from '../../icons/HeartIcon';
import { CommentComposer } from '../CommentComposer';
import { CommentList } from '../CommentList';
import { CommentRow, REPLY_ACTION_OVERLAP, REPLY_INDENT } from '../CommentRow';
import type { ItemComment } from '../commentsApi';
import type { ReplyTarget, ThreadState } from '../useItemComments';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const create = (element: React.ReactElement): Renderer => {
  let renderer!: Renderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};
/** The comment's long-press handler (the row's Pressable), or undefined when the comment has none. */
const longPressOf = (renderer: Renderer, testID: string): (() => void) | undefined =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onLongPress === 'function')[0]?.props.onLongPress;
const byId = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));

const comment = (id: number, overrides: Partial<ItemComment> = {}): ItemComment => ({
  id,
  body: `comment ${id}`,
  createdAtUtc: new Date().toISOString(),
  author: { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false },
  ...overrides,
});
const reply = (id: number, root: number, overrides: Partial<ItemComment> = {}) => comment(id, { rootCommentId: root, parentCommentId: root, ...overrides });
const thread = (overrides: Partial<ThreadState> = {}): ThreadState => ({
  expanded: true,
  status: 'ready',
  replies: [],
  nextCursor: null,
  isLoadingMore: false,
  moreFailed: false,
  ...overrides,
});

describe('CommentRow - hearts, replies and placeholders', () => {
  const row = (props: Partial<React.ComponentProps<typeof CommentRow>> = {}) =>
    create(<CommentRow comment={comment(1)} {...props} />);

  it('shows 답글 달기 and a heart only where the screen handles them (an older list has neither)', () => {
    const plain = row();
    expect(exists(plain, 'comment-reply-1')).toBe(false);
    expect(exists(plain, 'comment-like-1')).toBe(false);

    const full = row({ onReply: jest.fn(), onToggleLike: jest.fn() });
    expect(texts(full)).toContain('답글 달기');
    expect(exists(full, 'comment-like-1')).toBe(true);
  });

  it('답글 달기 and the heart call back with the comment, and both are at least 44dp to touch', () => {
    const onReply = jest.fn();
    const onToggleLike = jest.fn();
    const renderer = row({ onReply, onToggleLike });

    act(() => byId(renderer, 'comment-reply-1').props.onPress());
    act(() => byId(renderer, 'comment-like-1').props.onPress());

    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(onToggleLike).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(StyleSheet.flatten(byId(renderer, 'comment-reply-1').props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(byId(renderer, 'comment-like-1').props.style)).toEqual(expect.objectContaining({ minHeight: 44, minWidth: 44 }));
  });

  it('the heart is an outline with no number at zero; solid with the number and a "cancel" label once liked', () => {
    const none = row({ onToggleLike: jest.fn() });
    expect(none.root.findByType(HeartIcon).props.filled).toBe(false);
    expect(exists(none, 'comment-like-count-1')).toBe(false);
    expect(byId(none, 'comment-like-1').props.accessibilityLabel).toBe('좋아요');

    const liked = row({ onToggleLike: jest.fn(), comment: comment(1, { viewerLiked: true, likeCount: 3 }) });
    expect(liked.root.findByType(HeartIcon).props.filled).toBe(true);
    expect(texts(liked)).toContain('3');
    expect(byId(liked, 'comment-like-1').props.accessibilityLabel).toBe('좋아요 취소, 좋아요 3개');
    expect(byId(liked, 'comment-like-1').props.accessibilityState).toEqual({ selected: true });

    const others = row({ onToggleLike: jest.fn(), comment: comment(1, { viewerLiked: false, likeCount: 2 }) });
    expect(others.root.findByType(HeartIcon).props.filled).toBe(false);
    expect(texts(others)).toContain('2');
  });

  it('a reply is indented exactly one level; a top-level comment is not', () => {
    expect(StyleSheet.flatten(row({ isReply: true, comment: reply(2, 1) }).root.findAll(node => node.props.testID === 'comment-2')[0].props.style).marginStart).toBe(REPLY_INDENT);
    expect(StyleSheet.flatten(row().root.findAll(node => node.props.testID === 'comment-1')[0].props.style).marginStart).toBeUndefined();
  });

  it('a reply to another reply starts with the answered person\'s name from the server - and a direct reply shows none', () => {
    const answering = row({ isReply: true, comment: reply(3, 1, { parentCommentId: 2, replyTo: { jupleId: 'WXYZ6789', displayName: '지우' }, body: 'agreed' }) });
    expect(texts(answering)).toContain('@지우 ');
    expect(answering.root.findAll(node => node.props.accessibilityLabel?.includes?.('@지우 agreed')).length).toBeGreaterThan(0);

    const direct = row({ isReply: true, comment: reply(2, 1) });
    expect(exists(direct, 'comment-mention-2')).toBe(false);
  });

  const bodyText = (renderer: Renderer, id: number) => renderer.root.findAll(node => node.props.testID === `comment-body-${id}` && node.type === Text)[0];
  const mentionCount = (renderer: Renderer, id: number) => renderer.root.findAll(node => node.props.testID === `comment-mention-${id}` && node.type === Text).length;
  const replyToJiwoo = { jupleId: 'WXYZ6789', displayName: '지우' };

  it('a clean new reply shows the blue @target once, then exactly what was written', () => {
    const renderer = row({ isReply: true, comment: reply(3, 1, { parentCommentId: 2, replyTo: replyToJiwoo, body: 'agreed' }) });
    expect(mentionCount(renderer, 3)).toBe(1);
    expect(texts(renderer).filter(text => text.includes('@지우'))).toHaveLength(1);
    expect(bodyText(renderer, 3).props.children[1]).toBe('agreed');
  });

  it('an older reply that stored the same leading "@name " shows it only once', () => {
    const renderer = row({ isReply: true, comment: reply(3, 1, { parentCommentId: 2, replyTo: replyToJiwoo, body: '@지우 agreed' }) });
    expect(mentionCount(renderer, 3)).toBe(1);
    expect(bodyText(renderer, 3).props.children[1]).toBe('agreed');
    expect(renderer.root.findAll(node => node.props.accessibilityLabel?.includes?.('@지우 agreed')).length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.accessibilityLabel?.includes?.('@지우 @지우')).length).toBe(0);
  });

  it('a different leading @name or one in the middle of the text is kept as written', () => {
    const different = row({ isReply: true, comment: reply(3, 1, { parentCommentId: 2, replyTo: replyToJiwoo, body: '@하늘 look' }) });
    expect(bodyText(different, 3).props.children[1]).toBe('@하늘 look');
    const middle = row({ isReply: true, comment: reply(4, 1, { parentCommentId: 2, replyTo: replyToJiwoo, body: 'thanks @지우 for this' }) });
    expect(bodyText(middle, 4).props.children[1]).toBe('thanks @지우 for this');
  });

  it('the reply label sits close under the body but keeps a 44dp touch box', () => {
    const renderer = row({ onReply: jest.fn(), onToggleLike: jest.fn() });
    expect(StyleSheet.flatten(byId(renderer, 'comment-reply-1').props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(byId(renderer, 'comment-like-1').props.style)).toEqual(expect.objectContaining({ minHeight: 44, minWidth: 44 }));
    // The line holding them reaches up over the body's bottom slack - the compact visual gap, not a big margin.
    expect(StyleSheet.flatten(renderer.root.findAll(node => node.props.testID === 'comment-actions-1')[0].props.style).marginTop).toBe(-REPLY_ACTION_OVERLAP);
    expect(REPLY_ACTION_OVERLAP).toBeGreaterThan(0);
  });

  it('without a nickname the answered person is shown by Juple ID', () => {
    const renderer = row({ isReply: true, comment: reply(3, 1, { parentCommentId: 2, replyTo: { jupleId: 'WXYZ6789', displayName: null } }) });
    expect(texts(renderer)).toContain('@WXYZ-6789 ');
  });

  it('a deleted comment is only "삭제된 댓글입니다." - no avatar, name, words, heart or answer button', () => {
    const renderer = row({ comment: comment(1, { isDeleted: true, body: '', author: { jupleId: '', displayName: null, profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false } }), onLongPress: jest.fn(), onReply: jest.fn(), onToggleLike: jest.fn() });

    expect(texts(renderer)).toEqual(['삭제된 댓글입니다.']);
    expect(exists(renderer, 'comment-reply-1')).toBe(false);
    expect(exists(renderer, 'comment-like-1')).toBe(false);
    expect(longPressOf(renderer, 'comment-1')).toBeUndefined();
  });
});

describe('CommentList - threads', () => {
  const list = (props: Partial<React.ComponentProps<typeof CommentList>> = {}) =>
    create(
      <CommentList
        canDeleteAny={false}
        comments={[comment(1, { replyCount: 2 }), comment(2)]}
        hasPrevious={false}
        isLoadingPrevious={false}
        onDelete={jest.fn()}
        onLoadPrevious={jest.fn()}
        onRetry={jest.fn()}
        onToggleReplies={jest.fn()}
        status="ready"
        threads={{}}
        totalCount={4}
        {...props}
      />,
    );

  it('"답글 N개 보기" only under a comment that has replies - collapsed by default, with nothing loaded', () => {
    const renderer = list();

    expect(texts(renderer)).toContain('답글 2개 보기');
    expect(exists(renderer, 'comment-replies-toggle-1')).toBe(true);
    expect(exists(renderer, 'comment-replies-toggle-2')).toBe(false);
    expect(exists(renderer, 'comment-replies-1')).toBe(false);
    expect(byId(renderer, 'comment-replies-toggle-1').props.accessibilityState).toEqual({ expanded: false });
  });

  it('tapping the toggle asks the screen to open (or hide) that thread', () => {
    const onToggleReplies = jest.fn();
    const renderer = list({ onToggleReplies });

    act(() => byId(renderer, 'comment-replies-toggle-1').props.onPress());

    expect(onToggleReplies).toHaveBeenCalledWith(1);
  });

  it('an opened thread shows "답글 숨기기" and its replies, all at the same one indent', () => {
    const renderer = list({
      threads: {
        1: thread({ replies: [reply(10, 1), reply(11, 1, { parentCommentId: 10, replyTo: { jupleId: 'WXYZ6789', displayName: '지우' } })] }),
      },
    });

    expect(texts(renderer)).toContain('답글 숨기기');
    expect(byId(renderer, 'comment-replies-toggle-1').props.accessibilityState).toEqual({ expanded: true });
    const indents = ['comment-10', 'comment-11'].map(id =>
      StyleSheet.flatten(renderer.root.findAll(node => node.props.testID === id && typeof node.type === 'string')[0].props.style).marginStart,
    );
    expect(indents).toEqual([REPLY_INDENT, REPLY_INDENT]); // a reply to a reply is NOT indented deeper
    expect(texts(renderer)).toContain('@지우 ');
  });

  it('a collapsed thread keeps its replies out of the tree', () => {
    const renderer = list({ threads: { 1: thread({ expanded: false, replies: [reply(10, 1)] }) } });

    expect(exists(renderer, 'comment-10')).toBe(false);
    expect(texts(renderer)).toContain('답글 2개 보기');
  });

  it('while the first reply page loads there is a spinner; if it fails, a retry that asks for that thread again', () => {
    const loading = list({ threads: { 1: thread({ status: 'loading' }) } });
    expect(exists(loading, 'comment-replies-loading-1')).toBe(true);

    const onRetryReplies = jest.fn();
    const failed = list({ threads: { 1: thread({ status: 'error' }) }, onRetryReplies });
    expect(exists(failed, 'comment-replies-error-1')).toBe(true);
    act(() => failed.root.findAll(node => node.props.testID === 'comment-replies-error-1' && typeof node.props.onRetry === 'function')[0].props.onRetry());
    expect(onRetryReplies).toHaveBeenCalledWith(1);
    // The comments themselves are untouched.
    expect(exists(failed, 'comment-1')).toBe(true);
    expect(exists(failed, 'comment-2')).toBe(true);
  });

  it('"답글 더 보기" appears while more replies exist and loads the next page', () => {
    const onLoadMoreReplies = jest.fn();
    const renderer = list({ threads: { 1: thread({ replies: [reply(10, 1)], nextCursor: 10 }) }, onLoadMoreReplies });

    expect(texts(renderer)).toContain('답글 더 보기');
    act(() => byId(renderer, 'comment-replies-more-1').props.onPress());
    expect(onLoadMoreReplies).toHaveBeenCalledWith(1);

    const last = list({ threads: { 1: thread({ replies: [reply(10, 1)], nextCursor: null }) } });
    expect(exists(last, 'comment-replies-more-1')).toBe(false);
  });

  it('a failed later reply page leaves the replies in place and shows a compact retry under them', () => {
    const renderer = list({ threads: { 1: thread({ replies: [reply(10, 1)], nextCursor: 10, moreFailed: true }) } });

    expect(exists(renderer, 'comment-10')).toBe(true);
    expect(texts(renderer)).toContain('답글을 불러오지 못했어요. 눌러서 다시 시도하세요.');
    expect(exists(renderer, 'comment-replies-error-1')).toBe(false); // not the blocking failure state
    expect(StyleSheet.flatten(byId(renderer, 'comment-replies-more-1').props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('a deleted top-level comment with replies keeps its thread toggle; it offers neither a menu nor an answer', () => {
    const renderer = list({
      comments: [comment(1, { isDeleted: true, body: '', replyCount: 1 })],
      canDeleteAny: true,
      onReply: jest.fn(),
      onToggleLike: jest.fn(),
    });

    expect(texts(renderer)).toContain('삭제된 댓글입니다.');
    expect(texts(renderer)).toContain('답글 1개 보기');
    expect(longPressOf(renderer, 'comment-1')).toBeUndefined();
    expect(exists(renderer, 'comment-reply-1')).toBe(false);
  });

  it('a reply is deleted through the same menu and confirmation as any comment', () => {
    const onDelete = jest.fn();
    const renderer = list({
      comments: [comment(1, { replyCount: 1 })],
      onDelete,
      threads: { 1: thread({ replies: [reply(10, 1, { author: { jupleId: 'ME', displayName: '나', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: true } })] }) },
    });

    act(() => longPressOf(renderer, 'comment-10')!());
    const menu = renderer.root.findAll(node => Array.isArray(node.props.actions) && node.props.visible === true)[0];
    act(() => menu.props.actions[0].onPress());
    const confirm = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0];
    act(() => confirm.props.onConfirm());

    expect(onDelete).toHaveBeenCalledWith(10);
  });
});

describe('CommentComposer - reply mode', () => {
  const target = (overrides: Partial<ReplyTarget> = {}): ReplyTarget => ({ commentId: 1, rootCommentId: 1, name: '민욱', ...overrides });
  const composer = (props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) =>
    create(<CommentComposer isSending={false} onSubmit={jest.fn().mockResolvedValue(true)} {...props} />);
  const inputText = (renderer: Renderer) => renderer.root.findByType(TextInput).props.value;

  it('says whom the answer goes to above the field, with an X that is at least 44dp and ends reply mode', () => {
    const onCancelReply = jest.fn();
    const renderer = composer({ replyTarget: target(), onCancelReply });

    expect(texts(renderer)).toContain('민욱님에게 답글');
    expect(renderer.root.findByType(TextInput).props.placeholder).toBe('답글을 입력하세요');
    const cancel = byId(renderer, 'comment-reply-cancel');
    expect(cancel.props.accessibilityLabel).toBe('답글 취소');
    expect(StyleSheet.flatten(cancel.props.style)).toEqual(expect.objectContaining({ height: 44, width: 44 }));
    act(() => cancel.props.onPress());
    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it('without a reply target there is no context bar and the ordinary placeholder', () => {
    const renderer = composer();

    expect(exists(renderer, 'comment-reply-bar')).toBe(false);
    expect(renderer.root.findByType(TextInput).props.placeholder).toBe('댓글을 입력하세요');
  });

  it('reply mode never puts a mention into the field - the person writes only their own words', () => {
    expect(inputText(composer({ replyTarget: target({ commentId: 10, name: '지우' }) }))).toBe('');
    expect(inputText(composer({ replyTarget: target() }))).toBe('');
  });

  it('switching or leaving reply mode never touches what was typed', () => {
    const renderer = composer({ replyTarget: target({ commentId: 10, name: '지우' }) });
    act(() => renderer.root.findByType(TextInput).props.onChangeText('my words'));
    act(() => renderer.update(<CommentComposer isSending={false} onSubmit={jest.fn()} replyTarget={target({ commentId: 11, name: '하늘' })} />));
    expect(inputText(renderer)).toBe('my words');
    act(() => renderer.update(<CommentComposer isSending={false} onSubmit={jest.fn()} replyTarget={null} />));
    expect(inputText(renderer)).toBe('my words');
  });

  it('the text sent is exactly what was typed (trimmed) - no automatic @name', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true);
    const renderer = composer({ replyTarget: target({ commentId: 10, name: '지우' }), onSubmit });
    expect(byId(renderer, 'comment-send').props.disabled).toBe(true);
    act(() => renderer.root.findByType(TextInput).props.onChangeText('  맞아요 '));
    expect(byId(renderer, 'comment-send').props.disabled).toBe(false);

    await act(async () => byId(renderer, 'comment-send').props.onPress());

    expect(onSubmit).toHaveBeenCalledWith('맞아요');
  });
});
