import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ModerationNoticeScreen } from '../ModerationNoticeScreen';

const mockRequest = jest.fn();
const mockGoBack = jest.fn();
let mockParams = { noticeId: 5 };

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useNavigation: () => ({ goBack: mockGoBack, canGoBack: () => true }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

const warning = { id: 5, kind: 'warning', reason: '다른 사용자를 비방하는 표현이 확인되었습니다.', guidance: '표현에 주의해 주세요.', createdAtUtc: '2026-11-01T00:00:00Z', acknowledgedAtUtc: null };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockParams = { noticeId: 5 };
  mockRequest.mockImplementation(async (request: { method: string; path: string }) =>
    request.method === 'GET' ? { body: warning } : { body: undefined });
});
afterEach(() => jest.clearAllMocks());

async function render() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ModerationNoticeScreen />);
  });
  return renderer;
}

describe('ModerationNoticeScreen', () => {
  it('shows the operator\'s reviewed words as the warning, and confirms it once on the server', async () => {
    const renderer = await render();
    expect(texts(renderer)).toContain(i18n.t('moderation.warningTitle'));
    expect(texts(renderer)).toContain(i18n.t('moderation.warningIntro'));
    expect(texts(renderer)).toContain(warning.reason);
    expect(texts(renderer)).toContain(warning.guidance);

    const button = renderer.root.findAll(node => node.props.testID === 'moderation-notice-acknowledge' && typeof node.props.onPress === 'function')[0];
    await act(async () => button.props.onPress());
    expect(mockRequest).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/moderation-notices/5/acknowledge' });
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('a notice that was already confirmed (also after a re-login) shows that, not the button', async () => {
    mockRequest.mockResolvedValue({ body: { ...warning, acknowledgedAtUtc: '2026-11-01T01:00:00Z' } });
    const renderer = await render();
    expect(exists(renderer, 'moderation-notice-acknowledged')).toBe(true);
    expect(exists(renderer, 'moderation-notice-acknowledge')).toBe(false);
  });

  it('the result of the person\'s own report carries no reason or guidance, only the generic message', async () => {
    mockRequest.mockResolvedValue({ body: { id: 6, kind: 'reportResult', reason: null, guidance: null, createdAtUtc: '2026-11-01T00:00:00Z', acknowledgedAtUtc: null } });
    const renderer = await render();
    expect(texts(renderer)).toContain(i18n.t('moderation.resultTitle'));
    expect(texts(renderer)).toContain(i18n.t('moderation.resultMessage'));
    expect(exists(renderer, 'moderation-notice-reason')).toBe(false);
  });

  it('a failed confirmation stays on the screen and says so', async () => {
    const renderer = await render();
    mockRequest.mockRejectedValue(new Error('network'));
    const button = renderer.root.findAll(node => node.props.testID === 'moderation-notice-acknowledge' && typeof node.props.onPress === 'function')[0];
    await act(async () => button.props.onPress());
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(texts(renderer)).toContain(i18n.t('moderation.acknowledgeFailed'));
  });

  it('a notice that cannot be loaded offers a retry instead of a blank screen', async () => {
    mockRequest.mockRejectedValue(new Error('network'));
    const renderer = await render();
    expect(exists(renderer, 'moderation-notice-error')).toBe(true);
  });
});
