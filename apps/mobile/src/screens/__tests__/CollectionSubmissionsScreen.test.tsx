import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { CollectionSubmissionsScreen } from '../CollectionSubmissionsScreen';
import {
  approveCollectionSubmission,
  getCollectionSubmissions,
  rejectCollectionSubmission,
  type CollectionLinkSubmission,
} from '../../collections/api/collectionsApi';
import { markCollectionSubmissionRequestsRead } from '../../notifications/notificationsApi';
import { getUnreadCount, resetNotificationState } from '../../notifications/notificationState';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../notifications/notificationsApi', () => ({
  ...jest.requireActual('../../notifications/notificationsApi'),
  markCollectionSubmissionRequestsRead: jest.fn().mockResolvedValue({ markedCount: 1, unreadCount: 2 }),
}));
jest.mock('../../collections/api/collectionsApi', () => ({
  getCollectionSubmissions: jest.fn(),
  approveCollectionSubmission: jest.fn(),
  rejectCollectionSubmission: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => jest.clearAllMocks());

const route = { key: 'CollectionSubmissions', name: 'CollectionSubmissions', params: { collectionId: 5 } } as never;

const byMember: CollectionLinkSubmission = {
  submissionId: 11,
  url: 'https://example.com/a',
  title: 'Member idea',
  previewImageUrl: 'https://cdn.example/a.jpg',
  submittedAtUtc: '2026-10-01T00:00:00Z',
  viaPublicShare: false,
  proposer: { kind: 'member', jupleId: 'MMBR2345', displayName: '꼬부기', profileImageUrl: 'https://blob.example/m.jpg', profileImageVersion: 'v1' },
};
const viaPublicLink: CollectionLinkSubmission = {
  submissionId: 12,
  url: 'https://news.example.org/b',
  title: null,
  previewImageUrl: null,
  submittedAtUtc: '2026-10-01T01:00:00Z',
  viaPublicShare: true,
  proposer: null,
};

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <CollectionSubmissionsScreen navigation={{} as never} route={route} />
      </AppToastProvider>,
    );
  });
  return renderer;
}

const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  await act(async () => {
    await target.props.onPress();
  });
};
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const shown = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(node => node.props.children);

describe('CollectionSubmissionsScreen', () => {
  it('lists each proposal with its preview, title, site and proposer - someone who came through the public link is never named', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    const renderer = await renderScreen();

    expect(getCollectionSubmissions).toHaveBeenCalledWith(expect.anything(), 5);
    const memberRow = renderer.root.findAll(node => node.props.testID === 'submission-11')[0];
    expect(memberRow.findAll(node => node.type === Image && node.props.testID === 'submission-thumbnail-11')[0].props.source).toEqual({ uri: 'https://cdn.example/a.jpg' });
    expect(memberRow.findByType(UserAvatar).props).toEqual(expect.objectContaining({ jupleId: 'MMBR2345', imageUrl: 'https://blob.example/m.jpg' }));
    expect(JSON.stringify(shown(renderer))).toContain('Member idea');
    expect(JSON.stringify(shown(renderer))).toContain('example.com');
    expect(JSON.stringify(shown(renderer))).toContain('꼬부기');

    const publicRow = renderer.root.findAll(node => node.props.testID === 'submission-12')[0];
    expect(publicRow.findAllByType(UserAvatar)).toHaveLength(0);
    expect(JSON.stringify(publicRow.findAllByType(Text).map(node => node.props.children))).toContain('공개 링크로 제안됨');
    // No title: the site stands in for it.
    expect(JSON.stringify(publicRow.findAllByType(Text).map(node => node.props.children))).toContain('news.example.org');
  });

  it('seeing the list reads its 승인 요청 notifications (the requests themselves still wait); a failed load reads nothing', async () => {
    resetNotificationState();
    jest.mocked(getCollectionSubmissions).mockResolvedValueOnce({ items: [byMember], nextCursor: null });
    await renderScreen();

    expect(markCollectionSubmissionRequestsRead).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(getUnreadCount()).toBe(2);
    expect(approveCollectionSubmission).not.toHaveBeenCalled();
    expect(rejectCollectionSubmission).not.toHaveBeenCalled();

    jest.mocked(markCollectionSubmissionRequestsRead).mockClear();
    jest.mocked(getCollectionSubmissions).mockRejectedValueOnce(new ApiError('forbidden', 403, 'collectionLocked'));
    await renderScreen();
    expect(markCollectionSubmissionRequestsRead).not.toHaveBeenCalled();
  });

  it('승인 adds it and the row leaves - no reload of the list', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    jest.mocked(approveCollectionSubmission).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await press(renderer, 'submission-approve-11');

    expect(approveCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(exists(renderer, 'submission-12')).toBe(true);
    expect(shown(renderer)).toContain('링크를 컬렉션에 추가했어요.');
    expect(getCollectionSubmissions).toHaveBeenCalledTimes(1);
  });

  it('거절 asks first, then drops it - nothing is added', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
    jest.mocked(rejectCollectionSubmission).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    await press(renderer, 'submission-reject-11');
    expect(rejectCollectionSubmission).not.toHaveBeenCalled();
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible)!;
    expect(confirm.props.title).toBe('이 링크 요청을 거절할까요?');
    await act(async () => {
      confirm.props.onConfirm();
    });

    expect(rejectCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(approveCollectionSubmission).not.toHaveBeenCalled();
    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(shown(renderer)).toContain(i18n.t('submissions.empty'));
  });

  it('already handled elsewhere, or no longer addable: the row leaves and says why; a plain failure keeps it', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink, { ...byMember, submissionId: 13 }], nextCursor: null });
    jest.mocked(approveCollectionSubmission)
      .mockRejectedValueOnce(new ApiError('notFound', 404))
      .mockRejectedValueOnce(new ApiError('conflict', 409, 'linkAlreadyInCollection'))
      .mockRejectedValueOnce(new Error('offline'));
    const renderer = await renderScreen();

    await press(renderer, 'submission-approve-11');
    expect(exists(renderer, 'submission-11')).toBe(false);
    await press(renderer, 'submission-approve-12');
    expect(exists(renderer, 'submission-12')).toBe(false);
    expect(shown(renderer)).toContain('이미 컬렉션에 있는 링크예요.');
    await press(renderer, 'submission-approve-13');
    expect(exists(renderer, 'submission-13')).toBe(true);
    expect(shown(renderer)).toContain(i18n.t('submissions.actionError'));
  });

  it('nothing waiting: says so', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [], nextCursor: null });
    const renderer = await renderScreen();

    expect(shown(renderer)).toContain('승인 대기 중인 링크가 없어요.');
  });
});
