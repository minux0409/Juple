import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, Text } from 'react-native';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { ModerationNoticeHost } from '../ModerationNoticeHost';

const mockRequest = jest.fn();
let mockRoute: { name: string; params?: unknown } | undefined;

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: () => mockRoute !== undefined, getCurrentRoute: () => mockRoute },
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const dialog = (renderer: Renderer) => renderer.root.findAllByType(ConfirmDialog).find(candidate => candidate.props.visible === true);
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

const deleted = {
  id: 11, kind: 'action', actionType: 'contentDeleted', contentTitle: '내가 올린 링크', contentType: 'Item', reasonCode: 'Spam',
  reason: null, guidance: '반복되면 이용이 제한될 수 있어요.', createdAtUtc: '2026-11-01T01:00:00Z', acknowledgedAtUtc: null,
};
const warning = { id: 12, kind: 'warning', reason: '표현에 주의가 필요해요.', guidance: '확인해 주세요.', createdAtUtc: '2026-11-01T02:00:00Z', acknowledgedAtUtc: null };
let unconfirmed: unknown[] = [];

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockRoute = { name: 'MainTabs' };
  unconfirmed = [deleted];
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (request: { method: string; path: string }) =>
    request.method === 'GET' ? { body: { items: unconfirmed } } : { body: undefined });
});
afterEach(() => jest.restoreAllMocks());

async function mount() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ModerationNoticeHost />);
  });
  return renderer;
}
const confirm = async (renderer: Renderer) => act(async () => dialog(renderer)!.props.onConfirm());
const posts = () => mockRequest.mock.calls.filter(([request]) => request.method === 'POST');

describe('ModerationNoticeHost (운영팀 안내 pop-up)', () => {
  it('on launch shows the unconfirmed action in plain words - title, what was done, the reason, the guidance - with only 확인', async () => {
    const renderer = await mount();
    const shown = dialog(renderer)!;
    expect(shown.props.title).toBe('Juple 운영팀 안내');
    expect(shown.props.message).toBe("회원님이 공유한 '내가 올린 링크'이(가) 운영정책에 따라 삭제되었습니다.");
    expect(shown.props.confirmLabel).toBe('확인했습니다');
    expect(shown.props.onCancel).toBeUndefined();
    expect(shown.props.dismissable).toBe(false);
    expect(texts(renderer)).toContain(i18n.t('safety.reasonSpam'));
    expect(texts(renderer)).toContain('반복되면 이용이 제한될 수 있어요.');
  });

  it('shows which link it was - title, Collection, action and reason - from the notice alone, and the small-screen scroll keeps the button reachable', async () => {
    unconfirmed = [{ ...deleted, collectionName: '여름 여행', contentImageUrl: 'https://img.example/a.jpg' }];
    const renderer = await mount();
    expect(texts(renderer)).toContain('내가 올린 링크');
    expect(texts(renderer)).toContain('공유 컬렉션 · 여름 여행');
    expect(texts(renderer)).toContain('삭제');
    expect(renderer.root.findAll(node => node.props.testID === 'moderation-popup-scroll').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => (node.type as unknown) === 'Image' && node.props.source?.uri === 'https://img.example/a.jpg').length).toBe(1);
  });

  it('no picture: the link placeholder, and nothing invented for a missing title or Collection', async () => {
    unconfirmed = [{ ...warning, contentType: 'Item', contentTitle: null, collectionName: null, contentImageUrl: null }];
    const renderer = await mount();
    expect(renderer.root.findAll(node => node.props.testID === 'saved-link-thumbnail-placeholder').length).toBeGreaterThan(0);
    expect(renderer.root.findAll(node => node.props.testID === 'moderation-notice-content')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'moderation-notice-collection')).toHaveLength(0);
    expect(texts(renderer)).toContain('경고');
  });

  it('confirming records it on the server once and the same message is not shown again, even when the next read still lists it', async () => {
    const renderer = await mount();
    await confirm(renderer);
    expect(posts()).toEqual([[{ method: 'POST', path: '/api/v1/moderation-notices/11/acknowledge' }]]);
    expect(dialog(renderer)).toBeUndefined();

    await act(async () => {
      emitSocialPushEvent({ type: 'adminWarning', collectionId: null, publicId: null, noticeId: 11 });
    });
    expect(dialog(renderer)).toBeUndefined();
  });

  it('several messages are shown one after another, with how many more wait - never stacked', async () => {
    unconfirmed = [deleted, warning];
    const renderer = await mount();
    expect(renderer.root.findAllByType(ConfirmDialog).filter(candidate => candidate.props.visible === true)).toHaveLength(1);
    expect(texts(renderer)).toContain(i18n.t('moderation.moreCount', { count: 1 }));
    await confirm(renderer);
    expect(dialog(renderer)!.props.message).toBe(i18n.t('moderation.warningIntro'));
    expect(texts(renderer)).not.toContain(i18n.t('moderation.moreCount', { count: 1 }));
    await confirm(renderer);
    expect(dialog(renderer)).toBeUndefined();
  });

  it('a failure to record the confirmation never traps the person: the message closes and is not offered again in this run', async () => {
    const renderer = await mount();
    mockRequest.mockRejectedValue(new Error('offline'));
    await confirm(renderer);
    expect(dialog(renderer)).toBeUndefined();
  });

  it('a push about a new message pops it up while the app is open', async () => {
    unconfirmed = [];
    const renderer = await mount();
    expect(dialog(renderer)).toBeUndefined();
    unconfirmed = [warning];
    await act(async () => {
      emitSocialPushEvent({ type: 'adminWarning', collectionId: null, publicId: null, noticeId: 12 });
    });
    expect(dialog(renderer)!.props.message).toBe(i18n.t('moderation.warningIntro'));
  });

  it('coming back to the foreground reads again', async () => {
    unconfirmed = [];
    let listener: (state: string) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, handler: (state: string) => void) => {
      listener = handler;
      return { remove: jest.fn() };
    }) as never);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    const renderer = await mount();
    unconfirmed = [deleted];
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 240_000);
    await act(async () => listener('active'));
    expect(dialog(renderer)).toBeDefined();
  });

  it('stays out of the way while that very message is open on its own screen', async () => {
    mockRoute = { name: 'ModerationNotice', params: { noticeId: 11 } };
    const renderer = await mount();
    expect(dialog(renderer)).toBeUndefined();
  });

  it('a person with nothing unconfirmed sees nothing, and a failed read is silent', async () => {
    unconfirmed = [];
    expect(dialog(await mount())).toBeUndefined();
    mockRequest.mockRejectedValue(new Error('offline'));
    expect(dialog(await mount())).toBeUndefined();
  });
});
