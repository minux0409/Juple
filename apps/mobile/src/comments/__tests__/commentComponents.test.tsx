import ReactTestRenderer, { act } from 'react-test-renderer';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { CrownIcon } from '../../icons/CrownIcon';
import { CommentComposer } from '../CommentComposer';
import { CommentList } from '../CommentList';
import { CommentRow } from '../CommentRow';
import { formatCommentTime } from '../formatCommentTime';
import type { ItemComment } from '../commentsApi';

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
const byId = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));

const comment = (id: number, overrides: Partial<ItemComment['author']> = {}, body = `comment ${id}`, createdAtUtc = new Date().toISOString()): ItemComment => ({
  id,
  body,
  createdAtUtc,
  author: { jupleId: 'ABCD2345', displayName: '민욱', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false, ...overrides },
});

describe('formatCommentTime', () => {
  const t = i18n.t.bind(i18n);
  const now = Date.parse('2026-10-01T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('방금 전 / N분 전 / N시간 전 for the last day', () => {
    expect(formatCommentTime(ago(10_000), t, now)).toBe('방금 전');
    expect(formatCommentTime(ago(3 * 60_000), t, now)).toBe('3분 전');
    expect(formatCommentTime(ago(59 * 60_000), t, now)).toBe('59분 전');
    expect(formatCommentTime(ago(2 * 3_600_000), t, now)).toBe('2시간 전');
  });

  it('a moment in the future (clock drift) is 방금 전; older than a day is the app\'s own date and time', () => {
    expect(formatCommentTime(new Date(now + 5_000).toISOString(), t, now)).toBe('방금 전');
    const old = formatCommentTime(ago(3 * 24 * 3_600_000), t, now);
    expect(old).not.toMatch(/전$/);
    expect(old).toMatch(/2026/);
  });
});

describe('CommentRow', () => {
  const row = (overrides: Partial<React.ComponentProps<typeof CommentRow>> = {}) =>
    create(<CommentRow canDelete={false} comment={comment(1)} onOpenMenu={jest.fn()} {...overrides} />);

  it('draws the avatar, the nickname, the time and the text - no card around it', () => {
    const renderer = row();

    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(1);
    // (the first text is the avatar's own initial - the fallback of a person without a photo)
    expect(texts(renderer)).toEqual(['민', '민욱', '방금 전', 'comment 1']);
  });

  it('the avatar shows the photo when there is one, else the initial (the shared avatar component\'s own fallback)', () => {
    const withPhoto = row({ comment: comment(1, { profileImageUrl: 'https://blob.example/a.jpg', profileImageVersion: 'v1' }) });
    expect(withPhoto.root.findByType(UserAvatar).props).toEqual(expect.objectContaining({ imageUrl: 'https://blob.example/a.jpg', imageVersion: 'v1', jupleId: 'ABCD2345', displayName: '민욱' }));

    const without = row();
    expect(without.root.findByType(UserAvatar).props.imageUrl).toBeNull();
  });

  it('without a nickname the Juple ID is the name', () => {
    expect(texts(row({ comment: comment(1, { displayName: null }) }))[0]).toBe('ABCD-2345');
  });

  it('the Collection owner\'s comment has a small crown - no 소유자 text - and says so for the screen reader', () => {
    const owner = row({ comment: comment(1, { isCollectionOwner: true }) });
    const member = row();

    expect(owner.root.findAllByType(CrownIcon)).toHaveLength(1);
    expect(texts(owner)).not.toContain('소유자');
    expect(owner.root.findAll(node => String(node.props.accessibilityLabel).startsWith('민욱(소유자)')).length).toBeGreaterThan(0);
    expect(member.root.findAllByType(CrownIcon)).toHaveLength(0);
  });

  it('the text is plain text: markup, links and markdown are shown exactly as typed, long unbroken text wraps', () => {
    const typed = '<b>bold</b> **md** https://example.com [x](y) &amp; ' + 'a'.repeat(400);
    const renderer = row({ comment: comment(1, {}, typed) });

    const body = renderer.root.findAll(node => node.props.testID === 'comment-body-1' && node.type === Text)[0];
    expect(body.props.children).toBe(typed);
    expect(StyleSheet.flatten(body.props.style).width).toBeUndefined();
    expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('shows the "..." only where the caller may delete, and opens the menu with that comment', () => {
    const onOpenMenu = jest.fn();
    expect(byId(row(), 'comment-more-1')).toBeUndefined();

    const renderer = row({ canDelete: true, onOpenMenu });
    expect(byId(renderer, 'comment-more-1').props.accessibilityLabel).toBe('댓글 더보기');
    act(() => byId(renderer, 'comment-more-1').props.onPress());
    expect(onOpenMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});

describe('CommentComposer', () => {
  const composer = (props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) =>
    create(<CommentComposer isSending={false} onSubmit={jest.fn().mockResolvedValue(true)} {...props} />);
  const type = (renderer: Renderer, value: string) => act(() => renderer.root.findByType(TextInput).props.onChangeText(value));

  it('is a multiline field of at most 1000 characters that grows to about four lines', () => {
    const input = composer().root.findByType(TextInput);

    expect(input.props.multiline).toBe(true);
    expect(input.props.maxLength).toBe(1000);
    expect(input.props.placeholder).toBe('댓글을 입력하세요');
    const style = StyleSheet.flatten(input.props.style);
    expect(style.maxHeight).toBeLessThanOrEqual(20 * 4 + 16);
    expect(style.maxHeight).toBeGreaterThanOrEqual(20 * 4);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('전송 is off for nothing and for whitespace only, on once there is text', () => {
    const renderer = composer();
    expect(byId(renderer, 'comment-send').props.disabled).toBe(true);

    type(renderer, '   \n  ');
    expect(byId(renderer, 'comment-send').props.disabled).toBe(true);

    type(renderer, ' hi ');
    expect(byId(renderer, 'comment-send').props.disabled).toBe(false);
    expect(StyleSheet.flatten(byId(renderer, 'comment-send').props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('sends the trimmed text, then clears the field', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true);
    const renderer = composer({ onSubmit });
    type(renderer, '  이거 괜찮아 보이네  \n');

    await act(async () => byId(renderer, 'comment-send').props.onPress());

    expect(onSubmit).toHaveBeenCalledWith('이거 괜찮아 보이네');
    expect(renderer.root.findByType(TextInput).props.value).toBe('');
  });

  it('a failed send keeps the text so it can be sent again', async () => {
    const onSubmit = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const renderer = composer({ onSubmit });
    type(renderer, 'important thought');

    await act(async () => byId(renderer, 'comment-send').props.onPress());
    expect(renderer.root.findByType(TextInput).props.value).toBe('important thought');
    expect(byId(renderer, 'comment-send').props.disabled).toBe(false);

    await act(async () => byId(renderer, 'comment-send').props.onPress());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(renderer.root.findByType(TextInput).props.value).toBe('');
  });

  it('while sending the field and 전송 are off - a double tap cannot send twice', () => {
    const renderer = composer({ isSending: true });
    type(renderer, 'text');

    expect(byId(renderer, 'comment-send').props.disabled).toBe(true);
    expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  });
});

describe('CommentList', () => {
  const list = (props: Partial<React.ComponentProps<typeof CommentList>> = {}) =>
    create(
      <CommentList
        canDeleteAny={false}
        comments={[]}
        hasPrevious={false}
        isLoadingPrevious={false}
        onDelete={jest.fn()}
        onLoadPrevious={jest.fn()}
        onRetry={jest.fn()}
        status="ready"
        totalCount={0}
        {...props}
      />,
    );

  it('댓글 N, oldest first as given, and nothing else when there is a conversation', () => {
    const renderer = list({ comments: [comment(1), comment(2, { isMe: true })], totalCount: 2 });

    expect(texts(renderer)[0]).toBe('댓글 2');
    expect(renderer.root.findAll(node => node.props.testID === 'comment-1' && typeof node.type === 'string')).toHaveLength(1);
    const order = renderer.root.findAll(node => typeof node.type === 'string' && /^comment-\d+$/.test(String(node.props.testID))).map(node => node.props.testID);
    expect(order).toEqual(['comment-1', 'comment-2']);
    expect(renderer.root.findAll(node => node.props.testID === 'comments-empty')).toHaveLength(0);
  });

  it('an empty conversation says so in small text', () => {
    const renderer = list();

    expect(texts(renderer)).toEqual(['댓글 0', '아직 댓글이 없습니다.']);
  });

  it('loading and a failed load stay inside this section; retry reloads', () => {
    const onRetry = jest.fn();
    const loading = list({ status: 'loading' });
    expect(loading.root.findAll(node => node.props.testID === 'comments-loading').length).toBeGreaterThan(0);
    expect(loading.root.findAll(node => node.props.testID === 'comments-empty')).toHaveLength(0);

    const failed = list({ status: 'error', onRetry });
    // The app-wide load-failure wording - no comment-specific sentence.
    expect(texts(failed)).toEqual(expect.arrayContaining(['불러오지 못했어요', '기록을 불러올 수 없습니다.', '다시 시도']));
    act(() => byId(failed, 'comments-error-retry').props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('"이전 댓글 보기" only while older comments exist', () => {
    const onLoadPrevious = jest.fn();
    expect(byId(list({ comments: [comment(5)], totalCount: 5 }), 'comments-load-previous')).toBeUndefined();

    const renderer = list({ comments: [comment(5)], totalCount: 5, hasPrevious: true, onLoadPrevious });
    expect(texts(renderer)).toContain('이전 댓글 보기');
    act(() => byId(renderer, 'comments-load-previous').props.onPress());
    expect(onLoadPrevious).toHaveBeenCalledTimes(1);
  });

  it('a member may delete only their own: the other comment has no "..."', () => {
    const renderer = list({ comments: [comment(1), comment(2, { isMe: true })], totalCount: 2 });

    expect(byId(renderer, 'comment-more-1')).toBeUndefined();
    expect(byId(renderer, 'comment-more-2')).toBeDefined();
  });

  it('the Owner may delete any comment', () => {
    const renderer = list({ canDeleteAny: true, comments: [comment(1), comment(2)], totalCount: 2 });

    expect(byId(renderer, 'comment-more-1')).toBeDefined();
    expect(byId(renderer, 'comment-more-2')).toBeDefined();
  });

  it('delete: "..." → 댓글 삭제 → 댓글을 삭제할까요? → 삭제 removes it; 취소 does nothing', () => {
    const onDelete = jest.fn();
    const renderer = list({ canDeleteAny: true, comments: [comment(7)], totalCount: 1, onDelete });
    const menu = () => renderer.root.findByType(ActionMenuDialog);
    const confirm = () => renderer.root.findByType(ConfirmDialog);

    expect(menu().props.visible).toBe(false);
    act(() => byId(renderer, 'comment-more-7').props.onPress());
    expect(menu().props.visible).toBe(true);
    expect(menu().props.actions.map((action: { label: string }) => action.label)).toEqual(['댓글 삭제']);

    act(() => menu().props.actions[0].onPress());
    expect(menu().props.visible).toBe(false);
    expect(confirm().props.visible).toBe(true);
    expect(confirm().props.title).toBe('댓글을 삭제할까요?');

    act(() => confirm().props.onCancel());
    expect(onDelete).not.toHaveBeenCalled();
    expect(confirm().props.visible).toBe(false);

    act(() => byId(renderer, 'comment-more-7').props.onPress());
    act(() => menu().props.actions[0].onPress());
    act(() => confirm().props.onConfirm());
    expect(onDelete).toHaveBeenCalledWith(7);
  });
});

describe('the keyboard', () => {
  it('the shared KeyboardSafeView is what keeps the composer above the keyboard (in the screen that owns it)', () => {
    const source: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../screens/CollectionSharedItemScreen.tsx'), 'utf8');

    expect(source).toMatch(/<KeyboardSafeView/);
    expect(KeyboardAvoidingView).toBeDefined();
  });
});
