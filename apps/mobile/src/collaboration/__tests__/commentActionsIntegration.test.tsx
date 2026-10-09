import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { AppToastProvider } from '../../components/AppToast';
import { NotificationToast } from '../../components/NotificationToast';
import { deleteItemComment, editItemComment, getItemComments, type ItemComment } from '../../comments/commentsApi';
import { usePersonProfile } from '../../friends/PersonProfileModal';
import { useItemCollaboration } from '../useItemCollaboration';

jest.mock('../../api/useAuthenticatedApi', () => {
  const request = jest.fn();
  return { useAuthenticatedApi: () => request };
});
jest.mock('../../comments/commentsApi', () => ({
  ...jest.requireActual('../../comments/commentsApi'),
  getItemComments: jest.fn(),
  getCommentReplies: jest.fn(),
  addItemComment: jest.fn(),
  deleteItemComment: jest.fn(),
  setCommentLike: jest.fn(),
  editItemComment: jest.fn(),
}));
jest.mock('../../friends/PersonProfileModal', () => ({ usePersonProfile: jest.fn() }));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

const author = (isMe: boolean, jupleId: string) => ({ jupleId, displayName: isMe ? '나' : '민욱', profileImageUrl: 'https://img/x', profileImageVersion: 'v1', isCollectionOwner: false, isMe });
const comment = (id: number, isMe: boolean, jupleId = 'ABCD2345'): ItemComment => ({
  id,
  body: `body ${id}`,
  createdAtUtc: new Date().toISOString(),
  author: author(isMe, jupleId),
  replyCount: 0,
  likeCount: 0,
  viewerLiked: false,
});

type Renderer = ReactTestRenderer.ReactTestRenderer;

async function mount(isCollectionOwner: boolean) {
  const openProfile = jest.fn();
  jest.mocked(usePersonProfile).mockReturnValue({ openProfile, profileModal: <></> } as never);
  jest.mocked(getItemComments).mockResolvedValue({ items: [comment(1, true, 'ME234567'), comment(2, false)], previousCursor: null, totalCount: 2 });
  function Screen() {
    const collaboration = useItemCollaboration({ collectionId: 5, itemId: 7, isCollectionOwner, row: {}, enabled: true });
    return <>{collaboration.comments}{collaboration.composer}</>;
  }
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<AppToastProvider><Screen /></AppToastProvider>);
  });
  return { renderer, openProfile };
}

const press = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0].props.onPress();
const longPress = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onLongPress === 'function')[0].props.onLongPress();
const labels = (renderer: Renderer) => (renderer.root.findByType(ActionMenuDialog).props.actions as { label: string }[]).map(action => action.label);

describe('comments on a link - profile taps, edit and delete through the real screen hook', () => {
  it('tapping an author opens the ONE shared profile flow with that author\'s public identity - never inferred from the name', async () => {
    const { renderer, openProfile } = await mount(false);

    act(() => press(renderer, 'comment-author-2'));
    act(() => press(renderer, 'comment-avatar-2'));
    expect(openProfile).toHaveBeenNthCalledWith(1, { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: 'https://img/x', profileImageVersion: 'v1', isSelf: false });
    expect(openProfile).toHaveBeenNthCalledWith(2, expect.objectContaining({ jupleId: 'ABCD2345', isSelf: false }));

    act(() => press(renderer, 'comment-author-1'));
    expect(openProfile).toHaveBeenLastCalledWith(expect.objectContaining({ jupleId: 'ME234567', isSelf: true }));
    // Nothing besides the public identity travels (no friendship state is requested per comment).
    expect(Object.keys(openProfile.mock.calls[0][0]).sort()).toEqual(['displayName', 'isSelf', 'jupleId', 'profileImageUrl', 'profileImageVersion']);
  });

  it('a member: 수정하기 + 삭제하기 on their own comment, nothing at all on somebody else\'s', async () => {
    const { renderer } = await mount(false);

    act(() => longPress(renderer, 'comment-1'));
    expect(labels(renderer)).toEqual(['수정하기', '삭제하기']);
    expect(renderer.root.findAll(node => node.props.testID === 'comment-2' && typeof node.props.onLongPress === 'function')).toHaveLength(0);
  });

  it('the Owner: 삭제하기 only on somebody else\'s comment, both on their own', async () => {
    const { renderer } = await mount(true);

    act(() => longPress(renderer, 'comment-2'));
    expect(labels(renderer)).toEqual(['삭제하기']);
  });

  it('수정하기 → the composer switches to 댓글 수정 with the words → 수정 saves in place through the edit API', async () => {
    const { renderer } = await mount(false);
    jest.mocked(editItemComment).mockResolvedValue({ ...comment(1, true, 'ME234567'), body: 'new words' });

    act(() => longPress(renderer, 'comment-1'));
    act(() => (renderer.root.findByType(ActionMenuDialog).props.actions as { onPress: () => void }[])[0].onPress());

    const input = () => renderer.root.findByProps({ testID: 'comment-input' });
    expect(renderer.root.findAll(node => node.props.testID === 'comment-edit-bar')).not.toHaveLength(0);
    expect(input().props.value).toBe('body 1');
    act(() => input().props.onChangeText('new words'));
    await act(async () => press(renderer, 'comment-send'));

    expect(editItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 1, 'new words', null);
    expect(renderer.root.findAll(node => node.props.testID === 'comment-body-1')[0].props.children).toBe('new words');
    expect(renderer.root.findAll(node => node.props.testID === 'comment-edit-bar')).toHaveLength(0);
    expect(getItemComments).toHaveBeenCalledTimes(1);
  });

  it('a failed edit keeps the text and the edit mode, says so in a centered message dialog (not a toast), and never reloads', async () => {
    const { renderer } = await mount(false);

    jest.mocked(editItemComment).mockRejectedValue(new Error('offline'));
    act(() => longPress(renderer, 'comment-1'));
    act(() => (renderer.root.findByType(ActionMenuDialog).props.actions as { onPress: () => void }[])[0].onPress());
    act(() => renderer.root.findByProps({ testID: 'comment-input' }).props.onChangeText('keep me'));

    await act(async () => press(renderer, 'comment-send'));

    expect(renderer.root.findByProps({ testID: 'comment-input' }).props.value).toBe('keep me');
    expect(renderer.root.findAll(node => node.props.testID === 'comment-edit-bar')).not.toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'comment-body-1')[0].props.children).toBe('body 1');
    const notice = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true && node.props.message === i18n.t('comments.editError'));
    expect(notice).toHaveLength(1);
    expect(notice[0].props.title).toBe(i18n.t('common.notice'));
    expect(renderer.root.findAllByType(NotificationToast)).toHaveLength(0);
    expect(getItemComments).toHaveBeenCalledTimes(1);
    // Closing the message leaves the person in edit mode with their text.
    await act(async () => notice[0].props.onConfirm());
    expect(renderer.root.findByProps({ testID: 'comment-input' }).props.value).toBe('keep me');
  });

  it('삭제하기 asks first, then deletes through the same tombstone-aware flow', async () => {
    const { renderer } = await mount(false);
    jest.mocked(deleteItemComment).mockResolvedValue(undefined);

    act(() => longPress(renderer, 'comment-1'));
    act(() => (renderer.root.findByType(ActionMenuDialog).props.actions as { onPress: () => void }[])[1].onPress());
    const confirm = renderer.root.findAll(node => typeof node.props.onConfirm === 'function' && node.props.visible === true)[0];
    expect(confirm.props.title).toBe('댓글을 삭제할까요?');
    await act(async () => confirm.props.onConfirm());

    expect(deleteItemComment).toHaveBeenCalledWith(expect.anything(), 5, 7, 1, null);
    expect(renderer.root.findAll(node => node.props.testID === 'comment-1')).toHaveLength(0);
  });
});
