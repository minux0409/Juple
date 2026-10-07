import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { SupportInquiryDetailScreen } from '../SupportInquiryDetailScreen';
import { getSupportInquiry, type SupportInquiry } from '../../support/api/supportInquiryApi';

jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { inquiryId: 12 } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../support/api/supportInquiryApi', () => ({
  ...jest.requireActual('../../support/api/supportInquiryApi'),
  getSupportInquiry: jest.fn(),
}));

const pending: SupportInquiry = {
  inquiryId: 12,
  type: 'Bug',
  status: 'Pending',
  content: 'Images do not show up\nafter saving.',
  createdAtUtc: '2026-10-07T09:42:00Z',
  answer: null,
  answeredAtUtc: null,
};
const answered: SupportInquiry = { ...pending, type: 'FeatureRequest', status: 'Answered', answer: 'Thanks - this is planned.', answeredAtUtc: '2026-10-08T01:00:00Z' };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => {
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SupportInquiryDetailScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.find(node => node.props.testID === testID && typeof node.type === 'string');
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

describe('SupportInquiryDetailScreen', () => {
  it('reads the inquiry by id and shows the type, status in words, the full question and when it was received', async () => {
    jest.mocked(getSupportInquiry).mockResolvedValue(pending);
    const renderer = await renderScreen();

    expect(getSupportInquiry).toHaveBeenCalledWith(expect.any(Function), 12);
    expect(byId(renderer, 'inquiry-detail-type').props.children).toBe('오류/버그');
    expect(byId(renderer, 'inquiry-detail-status').props.children).toBe('접수');
    expect(byId(renderer, 'inquiry-detail-content').props.children).toBe('Images do not show up\nafter saving.');
    expect(texts(renderer)).toEqual(expect.arrayContaining(['문의 내용', '접수일', '답변']));
    expect(exists(renderer, 'inquiry-detail-created')).toBe(true);
  });

  it('a pending inquiry says the answer is awaited - no answer date, no answer text', async () => {
    jest.mocked(getSupportInquiry).mockResolvedValue(pending);
    const renderer = await renderScreen();

    expect(byId(renderer, 'inquiry-detail-waiting').props.children).toBe('답변을 기다리고 있어요.');
    expect(exists(renderer, 'inquiry-detail-answer')).toBe(false);
    expect(exists(renderer, 'inquiry-detail-answered')).toBe(false);
    expect(texts(renderer)).not.toContain('답변일');
  });

  it('an answered inquiry shows the answer and its date', async () => {
    jest.mocked(getSupportInquiry).mockResolvedValue(answered);
    const renderer = await renderScreen();

    expect(byId(renderer, 'inquiry-detail-status').props.children).toBe('답변완료');
    expect(byId(renderer, 'inquiry-detail-answer').props.children).toBe('Thanks - this is planned.');
    expect(texts(renderer)).toContain('답변일');
    expect(exists(renderer, 'inquiry-detail-answered')).toBe(true);
    expect(exists(renderer, 'inquiry-detail-waiting')).toBe(false);
  });

  it('is read-only: no edit, delete or diagnostics', async () => {
    jest.mocked(getSupportInquiry).mockResolvedValue(answered);
    const renderer = await renderScreen();

    expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/appVersion|buildNumber|deviceModel|osVersion/i);
  });

  it('an inquiry that is not the caller\'s (or does not exist) says so, without retrying', async () => {
    jest.mocked(getSupportInquiry).mockRejectedValue(new ApiError('notFound', 404));
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain('문의를 찾을 수 없어요.');
    expect(exists(renderer, 'inquiry-detail-content')).toBe(false);
  });

  it('a load failure shows the standard failure state, and retrying loads it', async () => {
    jest.mocked(getSupportInquiry).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();
    expect(exists(renderer, 'inquiry-detail-error')).toBe(true);

    jest.mocked(getSupportInquiry).mockResolvedValue(pending);
    await act(async () => {
      renderer.root.find(node => String(node.props.testID).startsWith('inquiry-detail-error') && typeof node.props.onRetry === 'function').props.onRetry();
    });
    expect(exists(renderer, 'inquiry-detail')).toBe(true);
  });
});
