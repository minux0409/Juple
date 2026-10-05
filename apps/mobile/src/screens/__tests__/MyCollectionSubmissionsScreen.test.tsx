import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { MyCollectionSubmissionsScreen } from '../MyCollectionSubmissionsScreen';
import type { MyCollectionLinkSubmission } from '../../collections/api/collectionsApi';
import { cancelMyPublicSubmission, getMyPublicSubmissions } from '../../collections/api/publicShareWriteApi';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { ApiError } from '../../api/ApiError';

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
jest.mock('../../collections/api/publicShareWriteApi', () => ({
  getMyPublicSubmissions: jest.fn(),
  cancelMyPublicSubmission: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

// A member's own waiting links are the ApprovalSubmissionSheet popup; this screen is only the public-link door.
const route = { key: 'MyCollectionSubmissions', name: 'MyCollectionSubmissions', params: { publicId: 'pub-1' } } as never;
const mine = (id: number, title: string | null, url = `https://example.com/${id}`): MyCollectionLinkSubmission => ({
  submissionId: id,
  url,
  title,
  previewImageUrl: null,
  submittedAtUtc: '2026-10-01T00:00:00Z',
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MyCollectionSubmissionsScreen navigation={{} as never} route={route} />);
  });
  return renderer;
}
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

describe('MyCollectionSubmissionsScreen (a public-link submitter\'s 내 승인 대기)', () => {
  it('lists my waiting links through the link - title (else site), site, "승인 대기 중", when - and nothing to act on', async () => {
    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(11, 'My idea'), mine(12, null, 'https://news.example.org/x')], nextCursor: null, totalCount: 2 });
    const renderer = await renderScreen();

    expect(getMyPublicSubmissions).toHaveBeenCalledWith(expect.anything(), 'pub-1', undefined);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['My idea', 'news.example.org']));
    // The same compact card as the popup: no "승인 대기 중" line, no Collection said.
    expect(texts(renderer).some(text => text === '승인 대기 중')).toBe(false);
    // Nothing to approve or reject - the only visible control is the external-link icon (cancelling is a swipe) - and no internal ids shown.
    expect(renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'button').map(node => node.props.testID))
      .toEqual(['submission-open-11', 'submission-open-12']);
    expect(renderer.root.findAllByType(SwipeableItemRow).map(row => row.props.deleteTestID)).toEqual(['submission-cancel-11', 'submission-cancel-12']);
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('submission-approve'))).toHaveLength(0);
    expect(texts(renderer).some(text => text === '11' || text === '12')).toBe(false);
    expect(renderer.root.findByProps({ testID: 'my-submission-info-11' }).props.accessibilityLabel).toContain('My idea');
  });

  it('the swipe row is one continuous surface: the card inside is square and edge-to-edge, the swipe frame supplies the rounded clip', async () => {
    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(11, 'My idea')], nextCursor: null, totalCount: 1 });
    const renderer = await renderScreen();

    const swipe = renderer.root.findAllByType(SwipeableItemRow).find(row => row.props.deleteTestID === 'submission-cancel-11')!;
    expect(swipe.props.deleteIconOnly).toBe(true);
    const frame = StyleSheet.flatten(swipe.props.containerStyle);
    expect(frame.borderRadius).toBeGreaterThan(0);
    const card = swipe.find(node => typeof node.type === 'string' && node.props.testID === 'my-submission-11');
    // No rounded card floating inside the frame: nothing but the frame rounds the row, so the red underlay has no gap.
    expect(StyleSheet.flatten(card.props.style).borderRadius).toBe(0);
  });

  it('요청 취소 through the public link: confirmed first, then only MY proposal through THIS link is cancelled and only its row leaves', async () => {
    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(11, 'First'), mine(12, 'Second')], nextCursor: null, totalCount: 2 });
    jest.mocked(cancelMyPublicSubmission).mockResolvedValue(undefined);
    const renderer = await renderScreen();

    // Swipe the card left: that only reveals the action ...
    const swipe = renderer.root.findAllByType(SwipeableItemRow).find(row => row.props.deleteTestID === 'submission-cancel-11')!;
    await act(async () => {
      swipe.findAll(node => Array.isArray(node.props.accessibilityActions))[0].props.onResponderGrant({
        touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
        nativeEvent: {},
      });
    });
    expect(cancelMyPublicSubmission).not.toHaveBeenCalled();
    // ... tapping it asks; nothing is cancelled yet.
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'submission-cancel-11' && typeof node.props.onPress === 'function').props.onPress();
    });
    expect(cancelMyPublicSubmission).not.toHaveBeenCalled();
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '승인 요청을 취소할까요?')!;
    expect(confirm.props.visible).toBe(true);
    await act(async () => {
      confirm.props.onConfirm();
    });

    expect(cancelMyPublicSubmission).toHaveBeenCalledWith(expect.anything(), 'pub-1', 11);
    expect(texts(renderer)).not.toContain('First');
    expect(texts(renderer)).toContain('Second');
  });

  it('says so when nothing of mine is waiting, and when the list cannot be loaded', async () => {
    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    const empty = await renderScreen();
    expect(texts(empty)).toContain(i18n.t('submissions.myEmpty'));

    jest.mocked(getMyPublicSubmissions).mockRejectedValue(new Error('offline'));
    const failed = await renderScreen();
    expect(texts(failed)).toContain(i18n.t('submissions.myLoadError'));
  });

  it('pull-to-refresh reloads it: a link approved or declined meanwhile is gone', async () => {
    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(11, 'First'), mine(12, 'Second')], nextCursor: null, totalCount: 2 });
    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['First', 'Second']));

    jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(12, 'Second')], nextCursor: null, totalCount: 1 });
    await act(async () => {
      renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(texts(renderer)).not.toContain('First');
    expect(texts(renderer)).toContain('Second');
  });

  it('pages: the next page is appended, never duplicated', async () => {
    jest.mocked(getMyPublicSubmissions)
      .mockResolvedValueOnce({ items: [mine(13, 'Third'), mine(12, 'Second')], nextCursor: 12, totalCount: 3 })
      .mockResolvedValueOnce({ items: [mine(12, 'Second'), mine(11, 'First')], nextCursor: null, totalCount: 3 });
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(getMyPublicSubmissions).toHaveBeenLastCalledWith(expect.anything(), 'pub-1', 12);
    expect((renderer.root.findByType(FlatList).props.data as MyCollectionLinkSubmission[]).map(entry => entry.submissionId)).toEqual([13, 12, 11]);
  });

  it('a link that was switched off (or is protected) falls back to the safe unavailable message', async () => {
    jest.mocked(getMyPublicSubmissions).mockRejectedValue(new ApiError('notFound', 404, 'gone'));
    expect(texts(await renderScreen())).toContain(i18n.t('sharedCollection.unavailableMessage'));

    jest.mocked(getMyPublicSubmissions).mockRejectedValue(new ApiError('forbidden', 403, 'locked'));
    expect(texts(await renderScreen())).toContain(i18n.t('sharedCollection.unavailableMessage'));
  });
});
