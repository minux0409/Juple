import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, Platform, RefreshControl, Text } from 'react-native';
import i18n from '../../i18n';
import { SupportInquiryScreen } from '../SupportInquiryScreen';
import {
  createSupportInquiry,
  getSupportInquiries,
  SUPPORT_INQUIRY_MAX_LENGTH,
  SUPPORT_INQUIRY_TYPES,
  type SupportInquiry,
} from '../../support/api/supportInquiryApi';

const mockNavigate = jest.fn();
let mockParams: { initialTab?: 'write' | 'history' } | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getVersion: () => '3.1.4', getBuildNumber: () => '159', getSystemVersion: () => '15', getModel: () => 'SM-S936N' },
}));
let mockIdCounter = 0;
jest.mock('uuid', () => ({ v4: () => `request-${++mockIdCounter}` }));
const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../support/api/supportInquiryApi', () => ({
  ...jest.requireActual('../../support/api/supportInquiryApi'),
  createSupportInquiry: jest.fn(),
  getSupportInquiries: jest.fn(),
}));

function inquiry(id: number, overrides: Partial<SupportInquiry> = {}): SupportInquiry {
  return {
    inquiryId: id,
    type: 'Bug',
    status: 'Pending',
    content: `Question ${id}`,
    createdAtUtc: '2026-10-07T09:42:00Z',
    answer: null,
    answeredAtUtc: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  mockParams = undefined;
  mockIdCounter = 0;
  jest.mocked(getSupportInquiries).mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SupportInquiryScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && (typeof node.props.onPress === 'function' || typeof node.props.onChangeText === 'function'));
const hostById = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.find(node => node.props.testID === testID && typeof node.type === 'string');
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    byId(renderer, testID).props.onPress();
  });
};
const type = async (renderer: ReactTestRenderer.ReactTestRenderer, text: string) => {
  await act(async () => {
    byId(renderer, 'inquiry-content').props.onChangeText(text);
  });
};
const pickType = async (renderer: ReactTestRenderer.ReactTestRenderer, code: string) => {
  await press(renderer, 'inquiry-type-field');
  await press(renderer, `inquiry-type-${code}`);
};
const submit = (renderer: ReactTestRenderer.ReactTestRenderer) => byId(renderer, 'inquiry-submit');
const visibleDialog = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.type === Modal && node.props.visible === true && node.props.testID !== 'inquiry-type-picker')[0];
const dialogText = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  visibleDialog(renderer)?.findAllByType(Text).map(node => String(node.props.children)).join(' ');
const confirmDialog = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
  const button = visibleDialog(renderer).find(node => node.props.accessibilityLabel === i18n.t('common.confirm') && typeof node.props.onPress === 'function');
  await act(async () => {
    button.props.onPress();
  });
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe('SupportInquiryScreen - form', () => {
  it('has the two tabs, 문의하기 selected by default, exposed as tabs with their state', async () => {
    const renderer = await renderScreen();

    expect(i18n.t('inquiry.tabWrite')).toBe('문의하기');
    expect(i18n.t('inquiry.tabHistory')).toBe('문의내역');
    expect(byId(renderer, 'inquiry-tab-write').props.accessibilityRole).toBe('tab');
    expect(byId(renderer, 'inquiry-tab-write').props.accessibilityState).toEqual({ selected: true });
    expect(byId(renderer, 'inquiry-tab-history').props.accessibilityState).toEqual({ selected: false });
    expect(exists(renderer, 'inquiry-form')).toBe(true);
    expect(getSupportInquiries).not.toHaveBeenCalled();
  });

  it('can be opened straight on 문의내역', async () => {
    mockParams = { initialTab: 'history' };
    const renderer = await renderScreen();
    expect(exists(renderer, 'inquiry-form')).toBe(false);
    expect(getSupportInquiries).toHaveBeenCalledTimes(1);
  });

  it('offers the seven types by their stable codes, localized for display', async () => {
    const renderer = await renderScreen();
    await press(renderer, 'inquiry-type-field');

    expect(SUPPORT_INQUIRY_TYPES).toEqual(['Account', 'Subscription', 'LinkSaving', 'CollectionSharing', 'Bug', 'FeatureRequest', 'Other']);
    for (const code of SUPPORT_INQUIRY_TYPES) {
      expect(exists(renderer, `inquiry-type-${code}`)).toBe(true);
    }
    expect(texts(renderer)).toEqual(expect.arrayContaining(['계정', '결제/구독', '링크 저장', '컬렉션/공유', '오류/버그', '기능 제안', '기타']));
    expect(byId(renderer, 'inquiry-type-Bug').props.accessibilityRole).toBe('radio');
  });

  it('marks both fields required and shows the picked type, in a compact dialog', async () => {
    const renderer = await renderScreen();
    expect(byId(renderer, 'inquiry-type-field').props.accessibilityLabel).toContain(i18n.t('inquiry.required'));
    expect(byId(renderer, 'inquiry-content').props.accessibilityLabel).toContain(i18n.t('inquiry.required'));

    await pickType(renderer, 'Bug');
    expect(texts(renderer)).toContain('오류/버그');
    expect(byId(renderer, 'inquiry-type-field').props.accessibilityLabel).toContain('오류/버그');
    expect(renderer.root.findAll(node => node.type === Modal && node.props.visible === true && node.props.testID === 'inquiry-type-picker')).toHaveLength(0);
  });

  it('keeps 등록 disabled until a type is chosen and real text is written - whitespace is not text', async () => {
    const renderer = await renderScreen();
    expect(submit(renderer).props.disabled).toBe(true);

    await type(renderer, 'Hello');
    expect(submit(renderer).props.disabled).toBe(true);

    await pickType(renderer, 'Bug');
    expect(submit(renderer).props.disabled).toBe(false);

    await type(renderer, '  \n\t  ');
    expect(submit(renderer).props.disabled).toBe(true);
  });

  it('bounds the text at 4000 characters with a counter, and refuses more than that', async () => {
    const renderer = await renderScreen();
    expect(byId(renderer, 'inquiry-content').props.maxLength).toBe(SUPPORT_INQUIRY_MAX_LENGTH);
    expect(byId(renderer, 'inquiry-content').props.multiline).toBe(true);
    await type(renderer, 'abc');
    expect(texts(renderer)).toContain('3 / 4000');

    await pickType(renderer, 'Other');
    await type(renderer, 'x'.repeat(SUPPORT_INQUIRY_MAX_LENGTH));
    expect(submit(renderer).props.disabled).toBe(false);
    await type(renderer, 'x'.repeat(SUPPORT_INQUIRY_MAX_LENGTH + 1));
    expect(submit(renderer).props.disabled).toBe(true);
  });

  it('sends the stable type code, the trimmed text and ONLY app and device facts - no identity, no stored data', async () => {
    jest.mocked(createSupportInquiry).mockResolvedValue(inquiry(1));
    const renderer = await renderScreen();
    await pickType(renderer, 'CollectionSharing');
    await type(renderer, '  The invite does not arrive  \n');

    await press(renderer, 'inquiry-submit');

    expect(createSupportInquiry).toHaveBeenCalledTimes(1);
    const body = jest.mocked(createSupportInquiry).mock.calls[0][1];
    expect(body.type).toBe('CollectionSharing');
    expect(body.content).toBe('The invite does not arrive');
    expect(body.clientRequestId).toBe('request-1');
    expect(body.diagnostics).toEqual({ appVersion: '3.1.4', buildNumber: '159', platform: Platform.OS, osVersion: '15', deviceModel: 'SM-S936N', locale: 'ko' });
    expect(Object.keys(body).sort()).toEqual(['clientRequestId', 'content', 'diagnostics', 'type']);
    expect(Object.keys(body.diagnostics).sort()).toEqual(['appVersion', 'buildNumber', 'deviceModel', 'locale', 'osVersion', 'platform']);
    expect(JSON.stringify(body)).not.toMatch(/userId|email|juple id|token|https?:|memo|collection name/i);
  });

  it('protects against a double submit: one request while it is on its way, the button disabled meanwhile', async () => {
    const pending = deferred<SupportInquiry>();
    jest.mocked(createSupportInquiry).mockReturnValue(pending.promise);
    const renderer = await renderScreen();
    await pickType(renderer, 'Bug');
    await type(renderer, 'Hello');

    await act(async () => {
      byId(renderer, 'inquiry-submit').props.onPress();
      byId(renderer, 'inquiry-submit').props.onPress();
    });
    expect(createSupportInquiry).toHaveBeenCalledTimes(1);
    expect(submit(renderer).props.disabled).toBe(true);
    expect(byId(renderer, 'inquiry-content').props.editable).toBe(false);

    await act(async () => {
      pending.resolve(inquiry(1));
    });
    expect(createSupportInquiry).toHaveBeenCalledTimes(1);
  });

  it('a failed send keeps the draft, says so in the common dialog and allows sending again at once', async () => {
    jest.mocked(createSupportInquiry).mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();
    await pickType(renderer, 'Bug');
    await type(renderer, 'Keep this text');

    await press(renderer, 'inquiry-submit');

    expect(dialogText(renderer)).toContain(i18n.t('inquiry.submitFailed'));
    await confirmDialog(renderer);
    expect(byId(renderer, 'inquiry-content').props.value).toBe('Keep this text');
    expect(texts(renderer)).toContain('오류/버그');
    expect(submit(renderer).props.disabled).toBe(false);
  });

  it('a retry of the same draft reuses the same request id; an edited draft starts a new one', async () => {
    jest.mocked(createSupportInquiry).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(inquiry(1));
    const renderer = await renderScreen();
    await pickType(renderer, 'Bug');
    await type(renderer, 'Same text');

    await press(renderer, 'inquiry-submit');
    await confirmDialog(renderer);
    await press(renderer, 'inquiry-submit');
    await confirmDialog(renderer);
    await type(renderer, 'Edited text');
    await press(renderer, 'inquiry-submit');

    const ids = jest.mocked(createSupportInquiry).mock.calls.map(call => call[1].clientRequestId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('after a successful send: the form is cleared only then, the common dialog says it was received, and confirming shows 문의내역 with it on top', async () => {
    const created = inquiry(7, { content: 'Brand new question' });
    const response = deferred<SupportInquiry>();
    jest.mocked(createSupportInquiry).mockReturnValue(response.promise);
    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [created, inquiry(3)], nextCursor: null });
    const renderer = await renderScreen();
    await pickType(renderer, 'Bug');
    await type(renderer, 'Brand new question');

    await press(renderer, 'inquiry-submit');
    // Nothing is cleared while the server has not answered.
    expect(byId(renderer, 'inquiry-content').props.value).toBe('Brand new question');
    expect(visibleDialog(renderer)).toBeUndefined();

    await act(async () => {
      response.resolve(created);
    });
    expect(dialogText(renderer)).toContain('문의가 접수되었습니다.');
    expect(byId(renderer, 'inquiry-content').props.value).toBe('');
    expect(texts(renderer)).not.toContain('오류/버그');

    await confirmDialog(renderer);
    expect(exists(renderer, 'inquiry-form')).toBe(false);
    expect(byId(renderer, 'inquiry-tab-history').props.accessibilityState).toEqual({ selected: true });
    const rows = renderer.root.findByType(FlatList).props.data as SupportInquiry[];
    expect(rows.map(row => row.inquiryId)).toEqual([7, 3]);
  });
});

describe('SupportInquiryScreen - 문의내역', () => {
  const openHistory = async () => {
    mockParams = { initialTab: 'history' };
    return renderScreen();
  };

  it('shows a friendly empty state', async () => {
    const renderer = await openHistory();
    expect(texts(renderer)).toContain('아직 문의 내역이 없습니다.');
  });

  it('lists inquiries as rows: localized type, status in words, a two-line preview and the date', async () => {
    jest.mocked(getSupportInquiries).mockResolvedValue({
      items: [
        inquiry(2, { type: 'FeatureRequest', status: 'Answered', content: 'A long question '.repeat(30), answer: 'Done', answeredAtUtc: '2026-10-08T01:00:00Z' }),
        inquiry(1, { type: 'Bug', content: 'Images are missing' }),
      ],
      nextCursor: null,
    });
    const renderer = await openHistory();

    expect(texts(renderer)).toEqual(expect.arrayContaining(['기능 제안', '답변완료', '오류/버그', '접수', 'Images are missing']));
    expect(hostById(renderer, 'inquiry-status-2').props.children).toBe('답변완료');
    expect(hostById(renderer, 'inquiry-status-1').props.children).toBe('접수');
    const preview = renderer.root.find(node => node.type === Text && String(node.props.children).startsWith('A long question'));
    expect(preview.props.numberOfLines).toBe(2);
    const label = byId(renderer, 'inquiry-row-2').props.accessibilityLabel as string;
    expect(label).toContain('기능 제안');
    expect(label).toContain('답변완료');
    expect(byId(renderer, 'inquiry-row-1').props.accessibilityRole).toBe('button');
  });

  it('opens an inquiry on tap', async () => {
    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [inquiry(5)], nextCursor: null });
    const renderer = await openHistory();
    await press(renderer, 'inquiry-row-5');
    expect(mockNavigate).toHaveBeenCalledWith('SupportInquiryDetail', { inquiryId: 5 });
  });

  it('pages in more as the list ends - with the cursor, once, and never repeating a row', async () => {
    jest.mocked(getSupportInquiries)
      .mockResolvedValueOnce({ items: [inquiry(3), inquiry(2)], nextCursor: '2' })
      .mockResolvedValueOnce({ items: [inquiry(2), inquiry(1)], nextCursor: null });
    const renderer = await openHistory();

    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });
    expect(jest.mocked(getSupportInquiries).mock.calls[1][1]).toMatchObject({ cursor: '2' });
    expect((renderer.root.findByType(FlatList).props.data as SupportInquiry[]).map(row => row.inquiryId)).toEqual([3, 2, 1]);

    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });
    expect(getSupportInquiries).toHaveBeenCalledTimes(2);
  });

  it('pull to refresh reloads the first page', async () => {
    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [inquiry(1)], nextCursor: null });
    const renderer = await openHistory();
    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [inquiry(2), inquiry(1)], nextCursor: null });

    await act(async () => {
      renderer.root.findByType(RefreshControl).props.onRefresh();
    });

    expect((renderer.root.findByType(FlatList).props.data as SupportInquiry[]).map(row => row.inquiryId)).toEqual([2, 1]);
  });

  it('a first load that fails shows the standard failure state with a retry', async () => {
    jest.mocked(getSupportInquiries).mockRejectedValueOnce(new Error('offline'));
    const renderer = await openHistory();
    expect(exists(renderer, 'inquiry-history-error')).toBe(true);

    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [inquiry(1)], nextCursor: null });
    await act(async () => {
      renderer.root.find(node => String(node.props.testID).startsWith('inquiry-history-error') && typeof node.props.onRetry === 'function').props.onRetry();
    });
    expect(exists(renderer, 'inquiry-history-error')).toBe(false);
    expect(exists(renderer, 'inquiry-row-1')).toBe(true);
  });

  it('a refresh that fails keeps what is shown and offers the compact retry row instead', async () => {
    jest.mocked(getSupportInquiries).mockResolvedValue({ items: [inquiry(1)], nextCursor: null });
    const renderer = await openHistory();
    jest.mocked(getSupportInquiries).mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      renderer.root.findByType(RefreshControl).props.onRefresh();
    });

    expect(exists(renderer, 'inquiry-row-1')).toBe(true);
    expect(exists(renderer, 'inquiry-history-error')).toBe(false);
    expect(exists(renderer, 'inquiry-history-notice')).toBe(true);
  });

  it('a next page that fails keeps the loaded rows and retries just that page', async () => {
    jest.mocked(getSupportInquiries)
      .mockResolvedValueOnce({ items: [inquiry(3)], nextCursor: '3' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [inquiry(2)], nextCursor: null });
    const renderer = await openHistory();

    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });
    expect(exists(renderer, 'inquiry-row-3')).toBe(true);
    expect(exists(renderer, 'inquiry-history-notice')).toBe(true);

    await act(async () => {
      byId(renderer, 'inquiry-history-notice-retry').props.onPress();
    });
    expect(jest.mocked(getSupportInquiries).mock.calls[2][1]).toMatchObject({ cursor: '3' });
    expect(exists(renderer, 'inquiry-row-2')).toBe(true);
  });
});
