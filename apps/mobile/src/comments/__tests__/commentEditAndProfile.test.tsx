import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { CommentComposer } from '../CommentComposer';
import { CommentList } from '../CommentList';
import { HeartIcon } from '../../icons/HeartIcon';
import { CommentRow } from '../CommentRow';
import { editItemComment, getCommentReplies, getItemComments, type CommentReplyPage, type ItemComment, type ItemCommentPage } from '../commentsApi';
import { useItemComments, type EditTarget } from '../useItemComments';

jest.mock('../commentsApi', () => ({
  ...jest.requireActual('../commentsApi'),
  getItemComments: jest.fn(),
  getCommentReplies: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
  setCommentLike: jest.fn(),
  editItemComment: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

type Renderer = ReactTestRenderer.ReactTestRenderer;
const create = (element: React.ReactElement): Renderer => {
  let renderer!: Renderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

const me = { jupleId: 'ME234567', displayName: '나', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: true };
const other = { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false };
const comment = (id: number, overrides: Partial<ItemComment> = {}): ItemComment => ({
  id,
  body: `comment ${id}`,
  createdAtUtc: new Date().toISOString(),
  author: other,
  replyCount: 0,
  likeCount: 0,
  viewerLiked: false,
  ...overrides,
});
const reply = (id: number, root: number, overrides: Partial<ItemComment> = {}) => comment(id, { rootCommentId: root, parentCommentId: root, ...overrides });

const find = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const longPressOf = (renderer: Renderer, testID: string): (() => void) | undefined =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onLongPress === 'function')[0]?.props.onLongPress;

describe('comment row layout', () => {
  const row = (props: Partial<React.ComponentProps<typeof CommentRow>> = {}) =>
    create(<CommentRow comment={comment(1, { likeCount: 2 })} onReply={jest.fn()} onToggleLike={jest.fn()} {...props} />);

  it('the heart is NOT in the action row: it has its own narrow column on the RIGHT of the row, 답글 달기 stays alone under the body', () => {
    const renderer = row();

    const idsIn = (testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID)[0]
        .findAll(node => typeof node.props.testID === 'string' && typeof node.props.onPress === 'function')
        .map(node => node.props.testID);
    // The action row under the body holds only 답글 달기.
    expect([...new Set(idsIn('comment-actions-1'))]).toEqual(['comment-reply-1']);
    // The heart (and only the heart) is in the side column.
    expect([...new Set(idsIn('comment-side-1'))]).toEqual(['comment-like-1']);
    // Nothing else floats at the end of the row: no "...".
    expect(renderer.root.findAll(node => node.props.testID === 'comment-more-1')).toHaveLength(0);

    // In document order the side column comes AFTER the text block and its action row: it is the end edge of the row (mirrored in RTL).
    const order = [...new Set(renderer.root.findAll(node => node.props.testID === 'comment-body-1' || node.props.testID === 'comment-actions-1' || node.props.testID === 'comment-side-1').map(node => node.props.testID))];
    expect(order).toEqual(['comment-body-1', 'comment-actions-1', 'comment-side-1']);

    // Fixed narrow column pinned to the top, so long text wraps before it and it never sets the row height.
    const side = StyleSheet.flatten(renderer.root.findAll(node => node.props.testID === 'comment-side-1')[0].props.style);
    expect(side).toEqual(expect.objectContaining({ alignSelf: 'flex-start', flexShrink: 0, width: 44 }));
    expect(side.height).toBeUndefined();
    // The count stays with the heart and both targets are 44dp.
    expect(renderer.root.findAll(node => node.props.testID === 'comment-like-count-1').length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(find(renderer, 'comment-like-1').props.style)).toEqual(expect.objectContaining({ minHeight: 44, minWidth: 44 }));
    expect(StyleSheet.flatten(find(renderer, 'comment-reply-1').props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('a reply gets the same right-side heart, and its indentation is the one reply level', () => {
    const renderer = create(<CommentRow comment={reply(2, 1, { likeCount: 3, viewerLiked: true })} isReply onReply={jest.fn()} onToggleLike={jest.fn()} />);

    const idsIn = (testID: string) =>
      renderer.root.findAll(node => node.props.testID === testID)[0].findAll(node => typeof node.props.onPress === 'function' && typeof node.props.testID === 'string').map(node => node.props.testID);
    expect([...new Set(idsIn('comment-side-2'))]).toEqual(['comment-like-2']);
    expect([...new Set(idsIn('comment-actions-2'))]).toEqual(['comment-reply-2']);
    expect(StyleSheet.flatten(renderer.root.findAll(node => node.props.testID === 'comment-2')[0].props.style).marginStart).toBe(36);
  });

  it('an unliked comment shows the outline heart and no number; a liked one the filled red heart with its number', () => {
    const none = row({ comment: comment(1, { likeCount: 0, viewerLiked: false }) });
    expect(none.root.findAll(node => node.props.testID === 'comment-like-count-1')).toHaveLength(0);
    expect(none.root.findAllByType(HeartIcon)[0].props.filled).toBe(false);

    const liked = row({ comment: comment(1, { likeCount: 12, viewerLiked: true }) });
    expect(liked.root.findAllByType(HeartIcon)[0].props.filled).toBe(true);
    expect(liked.root.findAll(node => node.props.testID === 'comment-like-count-1')[0].props.children).toBe(12);
  });

  it('the heart still hearts, 답글 달기 still answers - and neither is the row\'s long-press', () => {
    const onToggleLike = jest.fn();
    const onReply = jest.fn();
    const onLongPress = jest.fn();
    const renderer = row({ onToggleLike, onReply, onLongPress });

    act(() => find(renderer, 'comment-like-1').props.onPress());
    act(() => find(renderer, 'comment-reply-1').props.onPress());

    expect(onToggleLike).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('comment author -> profile', () => {
  it('the avatar AND the name open the author\'s profile (their own explicit targets, not the whole row), and a long-press does not', () => {
    const onOpenProfile = jest.fn();
    const onLongPress = jest.fn();
    const renderer = create(<CommentRow comment={comment(4)} onLongPress={onLongPress} onOpenProfile={onOpenProfile} />);

    act(() => find(renderer, 'comment-avatar-4').props.onPress());
    act(() => find(renderer, 'comment-author-4').props.onPress());

    expect(onOpenProfile).toHaveBeenCalledTimes(2);
    expect(onOpenProfile).toHaveBeenCalledWith(expect.objectContaining({ id: 4, author: expect.objectContaining({ jupleId: 'ABCD2345' }) }));
    expect(find(renderer, 'comment-avatar-4').props.accessibilityLabel).toBe('민욱 프로필 보기');
    expect(find(renderer, 'comment-author-4').props.accessibilityLabel).toBe('민욱 프로필 보기');
    expect(onLongPress).not.toHaveBeenCalled();
    // The row itself is not a profile target.
    expect(renderer.root.findAll(node => node.props.testID === 'comment-4' && typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('without a profile handler the avatar and name are plain; a deleted comment has neither', () => {
    const plain = create(<CommentRow comment={comment(5)} />);
    expect(find(plain, 'comment-avatar-5')).toBeUndefined();
    expect(find(plain, 'comment-author-5')).toBeUndefined();

    const deleted = create(<CommentRow comment={comment(6, { isDeleted: true, body: '' })} onOpenProfile={jest.fn()} />);
    expect(find(deleted, 'comment-avatar-6')).toBeUndefined();
  });

  it('the list passes the same handler to top-level comments and replies', () => {
    const onOpenProfile = jest.fn();
    const renderer = create(
      <CommentList
        canDeleteAny={false}
        comments={[comment(1, { replyCount: 1 })]}
        hasPrevious={false}
        isLoadingPrevious={false}
        onDelete={jest.fn()}
        onLoadPrevious={jest.fn()}
        onOpenProfile={onOpenProfile}
        onRetry={jest.fn()}
        status="ready"
        threads={{ 1: { expanded: true, status: 'ready', replies: [reply(10, 1)], nextCursor: null, isLoadingMore: false, moreFailed: false } }}
        totalCount={2}
      />,
    );

    act(() => find(renderer, 'comment-author-1').props.onPress());
    act(() => find(renderer, 'comment-avatar-10').props.onPress());

    expect(onOpenProfile.mock.calls.map(([target]) => target.id)).toEqual([1, 10]);
  });
});

describe('comment long-press menu', () => {
  const list = (props: Partial<React.ComponentProps<typeof CommentList>> = {}) =>
    create(
      <CommentList
        canDeleteAny={false}
        comments={[]}
        hasPrevious={false}
        isLoadingPrevious={false}
        onDelete={jest.fn()}
        onEdit={jest.fn()}
        onLoadPrevious={jest.fn()}
        onRetry={jest.fn()}
        status="ready"
        totalCount={1}
        {...props}
      />,
    );
  const menu = (renderer: Renderer) => renderer.root.findByType(ActionMenuDialog);
  const labels = (renderer: Renderer) => (menu(renderer).props.actions as { label: string }[]).map(action => action.label);

  it('my own comment: 수정하기 then 삭제하기 - both with icons, the destructive one last', () => {
    const renderer = list({ comments: [comment(1, { author: me })] });

    act(() => longPressOf(renderer, 'comment-1')!());

    expect(menu(renderer).props.visible).toBe(true);
    expect(labels(renderer)).toEqual(['수정하기', '삭제하기']);
    const actions = menu(renderer).props.actions as { destructive?: boolean; icon?: unknown }[];
    expect(actions.every(action => action.icon !== undefined)).toBe(true);
    expect(actions.map(action => action.destructive === true)).toEqual([false, true]);
  });

  it('someone else\'s comment the Owner may delete: 삭제하기 only - never 수정하기', () => {
    const renderer = list({ canDeleteAny: true, comments: [comment(2)] });

    act(() => longPressOf(renderer, 'comment-2')!());

    expect(labels(renderer)).toEqual(['삭제하기']);
  });

  it('a comment the caller may not change has no long-press, so no empty menu can open', () => {
    const renderer = list({ comments: [comment(3)] });

    expect(longPressOf(renderer, 'comment-3')).toBeUndefined();
    expect(menu(renderer).props.visible).toBe(false);
  });

  it('a deleted placeholder (even in the Owner\'s list) has no menu and so no 수정하기', () => {
    const renderer = list({ canDeleteAny: true, comments: [comment(4, { isDeleted: true, body: '', replyCount: 1 })] });

    expect(longPressOf(renderer, 'comment-4')).toBeUndefined();
  });

  it('수정하기 hands the comment to the editor and closes the menu; 삭제하기 still asks first', () => {
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const own = comment(5, { author: me });
    const renderer = list({ comments: [own], onEdit, onDelete });

    act(() => longPressOf(renderer, 'comment-5')!());
    act(() => (menu(renderer).props.actions as { onPress: () => void }[])[0].onPress());
    expect(onEdit).toHaveBeenCalledWith(own);
    expect(menu(renderer).props.visible).toBe(false);

    act(() => longPressOf(renderer, 'comment-5')!());
    act(() => (menu(renderer).props.actions as { onPress: () => void }[])[1].onPress());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('without an edit handler nothing offers 수정하기 (a list that cannot edit)', () => {
    const renderer = list({ comments: [comment(6, { author: me })], onEdit: undefined });

    act(() => longPressOf(renderer, 'comment-6')!());

    expect(labels(renderer)).toEqual(['삭제하기']);
  });
});

describe('CommentComposer - edit mode', () => {
  const target = (overrides: Partial<EditTarget> = {}): EditTarget => ({ commentId: 9, body: 'my first words', ...overrides });
  const composer = (props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) =>
    create(<CommentComposer isSending={false} onSubmit={jest.fn().mockResolvedValue(true)} {...props} />);
  const input = (renderer: Renderer) => renderer.root.findByType(TextInput);
  const sendButton = (renderer: Renderer) => find(renderer, 'comment-send');
  const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));

  it('loads the existing words (and only the words - no @target), says 댓글 수정 with an X, and offers 수정 only once the text changed', () => {
    const renderer = composer({ editTarget: target(), onCancelEdit: jest.fn() });

    expect(input(renderer).props.value).toBe('my first words');
    expect(texts(renderer)).toContain('댓글 수정');
    expect(texts(renderer)).toContain('수정');
    expect(sendButton(renderer).props.disabled).toBe(true);
    act(() => input(renderer).props.onChangeText('my better words'));
    expect(sendButton(renderer).props.disabled).toBe(false);
    act(() => input(renderer).props.onChangeText('   '));
    expect(sendButton(renderer).props.disabled).toBe(true);
  });

  it('a reply\'s edit field holds just its body: the answered person is never in the editable text', () => {
    const renderer = composer({ editTarget: target({ body: 'agreed' }) });

    expect(input(renderer).props.value).toBe('agreed');
    expect(input(renderer).props.value).not.toMatch(/@/);
  });

  it('saving sends the trimmed words through onSubmit, and leaving edit mode empties the field again', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true);
    const renderer = composer({ editTarget: target(), onSubmit });
    act(() => input(renderer).props.onChangeText('  new words  '));

    await act(async () => sendButton(renderer).props.onPress());

    expect(onSubmit).toHaveBeenCalledWith('new words');
    act(() => renderer.update(<CommentComposer isSending={false} onSubmit={onSubmit} />));
    expect(input(renderer).props.value).toBe('');
  });

  it('a failed save keeps what was typed and stays in edit mode', async () => {
    const onSubmit = jest.fn().mockResolvedValue(false);
    const renderer = composer({ editTarget: target(), onSubmit });
    act(() => input(renderer).props.onChangeText('typed but not saved'));

    await act(async () => sendButton(renderer).props.onPress());

    expect(input(renderer).props.value).toBe('typed but not saved');
    expect(texts(renderer)).toContain('댓글 수정');
  });

  it('the X leaves edit mode without saving', () => {
    const onCancelEdit = jest.fn();
    const renderer = composer({ editTarget: target(), onCancelEdit });

    act(() => find(renderer, 'comment-edit-cancel').props.onPress());

    expect(onCancelEdit).toHaveBeenCalledTimes(1);
    expect(find(renderer, 'comment-edit-cancel').props.accessibilityLabel).toBe('수정 취소');
  });
});

describe('useItemComments - editing', () => {
  type Api = ReturnType<typeof useItemComments>;
  const pageOf = (items: ItemComment[]): ItemCommentPage => ({ items, previousCursor: null, totalCount: items.length });
  const repliesOf = (items: ItemComment[]): CommentReplyPage => ({ items, nextCursor: null, totalCount: items.length });

  async function renderHook() {
    const onFailure = jest.fn();
    const holder: { api?: Api } = {};
    const request = jest.fn() as never;
    function Harness() {
      holder.api = useItemComments(request, 5, 7, () => 'grant', onFailure, true, null);
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<Harness />);
    });
    return { holder, onFailure };
  }

  const mine = comment(1, { author: me, body: 'first', replyCount: 1, likeCount: 3, viewerLiked: true });
  const myReply = reply(10, 1, { author: me, body: 'agreed', likeCount: 1, viewerLiked: true, replyTo: { jupleId: 'ABCD2345', displayName: '민욱' } });

  async function loaded() {
    jest.mocked(getItemComments).mockResolvedValue(pageOf([mine]));
    jest.mocked(getCommentReplies).mockResolvedValue(repliesOf([myReply]));
    const context = await renderHook();
    await act(async () => context.holder.api!.toggleReplies(1));
    return context;
  }

  it('only my own live comment can be edited; a stranger\'s or a deleted one is ignored', async () => {
    jest.mocked(getItemComments).mockResolvedValue(pageOf([comment(2), comment(3, { author: me, isDeleted: true, body: '' })]));
    const { holder } = await renderHook();

    act(() => holder.api!.startEdit(holder.api!.comments[0]));
    expect(holder.api!.editTarget).toBeNull();
    act(() => holder.api!.startEdit(holder.api!.comments[1]));
    expect(holder.api!.editTarget).toBeNull();
  });

  it('saving changes ONLY the body in place: hearts, who hearted, reply count and the open thread stay', async () => {
    const { holder } = await loaded();
    jest.mocked(editItemComment).mockResolvedValue({ ...mine, body: 'first, edited', likeCount: 99 });

    act(() => holder.api!.startEdit(holder.api!.comments[0]));
    expect(holder.api!.editTarget).toEqual({ commentId: 1, body: 'first' });
    let saved = false;
    await act(async () => { saved = await holder.api!.saveEdit('first, edited'); });

    expect(saved).toBe(true);
    expect(editItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 1, 'first, edited', 'grant');
    expect(holder.api!.comments[0]).toEqual(expect.objectContaining({ body: 'first, edited', likeCount: 3, viewerLiked: true, replyCount: 1 }));
    expect(holder.api!.threads[1].expanded).toBe(true);
    expect(holder.api!.threads[1].replies).toHaveLength(1);
    expect(holder.api!.editTarget).toBeNull();
    expect(getItemComments).toHaveBeenCalledTimes(1); // no list reload
  });

  it('editing a reply changes its body only: the reply target stays metadata', async () => {
    const { holder } = await loaded();
    jest.mocked(editItemComment).mockResolvedValue({ ...myReply, body: 'agreed, really' });

    act(() => holder.api!.startEdit(holder.api!.threads[1].replies[0]));
    expect(holder.api!.editTarget!.body).toBe('agreed');
    await act(async () => { await holder.api!.saveEdit('agreed, really'); });

    expect(holder.api!.threads[1].replies[0]).toEqual(expect.objectContaining({
      body: 'agreed, really',
      replyTo: { jupleId: 'ABCD2345', displayName: '민욱' },
      rootCommentId: 1,
      parentCommentId: 1,
      likeCount: 1,
      viewerLiked: true,
    }));
  });

  it('a failed save changes nothing, reports the failure, and stays in edit mode so the text can be kept', async () => {
    const { holder, onFailure } = await loaded();
    jest.mocked(editItemComment).mockRejectedValue(new Error('offline'));
    act(() => holder.api!.startEdit(holder.api!.comments[0]));

    let saved = true;
    await act(async () => { saved = await holder.api!.saveEdit('lost?'); });

    expect(saved).toBe(false);
    expect(onFailure).toHaveBeenCalledWith('edit');
    expect(holder.api!.comments[0].body).toBe('first');
    expect(holder.api!.editTarget).not.toBeNull();
  });

  it('answering someone leaves edit mode (one mode at a time), and cancelEdit leaves it too', async () => {
    const { holder } = await loaded();
    act(() => holder.api!.startEdit(holder.api!.comments[0]));
    act(() => holder.api!.startReply(holder.api!.comments[0]));
    expect(holder.api!.editTarget).toBeNull();
    expect(holder.api!.replyTarget).not.toBeNull();

    act(() => holder.api!.startEdit(holder.api!.comments[0]));
    expect(holder.api!.replyTarget).toBeNull();
    act(() => holder.api!.cancelEdit());
    expect(holder.api!.editTarget).toBeNull();
  });
});
