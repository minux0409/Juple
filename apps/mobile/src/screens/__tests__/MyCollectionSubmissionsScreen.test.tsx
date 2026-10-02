import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import i18n from '../../i18n';
import { MyCollectionSubmissionsScreen } from '../MyCollectionSubmissionsScreen';
import { getMyCollectionSubmissions, type MyCollectionLinkSubmission } from '../../collections/api/collectionsApi';
import { getMyPublicSubmissions } from '../../collections/api/publicShareWriteApi';
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
jest.mock('../../collections/api/collectionsApi', () => ({
  getMyCollectionSubmissions: jest.fn(),
}));
jest.mock('../../collections/api/publicShareWriteApi', () => ({
  getMyPublicSubmissions: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

const route = { key: 'MyCollectionSubmissions', name: 'MyCollectionSubmissions', params: { collectionId: 5 } } as never;
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

describe('MyCollectionSubmissionsScreen (내 승인 대기)', () => {
  it('lists my waiting links - title (else site), site, "승인 대기 중", when - and nothing to act on', async () => {
    jest.mocked(getMyCollectionSubmissions).mockResolvedValue({ items: [mine(11, 'My idea'), mine(12, null, 'https://news.example.org/x')], nextCursor: null });
    const renderer = await renderScreen();

    expect(getMyCollectionSubmissions).toHaveBeenCalledWith(expect.anything(), 5, undefined);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['My idea', 'news.example.org', '승인 대기 중']));
    expect(texts(renderer).filter(text => text === '승인 대기 중')).toHaveLength(2);
    // View only: no approve / reject / cancel controls, and no internal ids shown.
    expect(renderer.root.findAll(node => node.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(texts(renderer).some(text => text === '11' || text === '12')).toBe(false);
    expect(renderer.root.findByProps({ testID: 'my-submission-11' }).props.accessibilityLabel).toBe('My idea, 승인 대기 중');
  });

  it('says so when nothing of mine is waiting, and when the list cannot be loaded', async () => {
    jest.mocked(getMyCollectionSubmissions).mockResolvedValue({ items: [], nextCursor: null });
    const empty = await renderScreen();
    expect(texts(empty)).toContain(i18n.t('submissions.myEmpty'));

    jest.mocked(getMyCollectionSubmissions).mockRejectedValue(new Error('offline'));
    const failed = await renderScreen();
    expect(texts(failed)).toContain(i18n.t('submissions.myLoadError'));
  });

  it('pull-to-refresh reloads it: a link approved or declined meanwhile is gone', async () => {
    jest.mocked(getMyCollectionSubmissions).mockResolvedValue({ items: [mine(11, 'First'), mine(12, 'Second')], nextCursor: null });
    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['First', 'Second']));

    jest.mocked(getMyCollectionSubmissions).mockResolvedValue({ items: [mine(12, 'Second')], nextCursor: null });
    await act(async () => {
      renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh();
    });
    expect(texts(renderer)).not.toContain('First');
    expect(texts(renderer)).toContain('Second');
  });

  it('pages: the next page is appended, never duplicated', async () => {
    jest.mocked(getMyCollectionSubmissions)
      .mockResolvedValueOnce({ items: [mine(13, 'Third'), mine(12, 'Second')], nextCursor: 12 })
      .mockResolvedValueOnce({ items: [mine(12, 'Second'), mine(11, 'First')], nextCursor: null });
    const renderer = await renderScreen();
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(getMyCollectionSubmissions).toHaveBeenLastCalledWith(expect.anything(), 5, 12);
    expect((renderer.root.findByType(FlatList).props.data as MyCollectionLinkSubmission[]).map(entry => entry.submissionId)).toEqual([13, 12, 11]);
  });

  describe('opened by a public link (a signed-in non-member)', () => {
    const publicRoute = { key: 'MyCollectionSubmissions', name: 'MyCollectionSubmissions', params: { publicId: 'pub-1' } } as never;
    async function renderPublic() {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(<MyCollectionSubmissionsScreen navigation={{} as never} route={publicRoute} />);
      });
      return renderer;
    }

    it('reads the same list through the link - never the Collection API', async () => {
      jest.mocked(getMyPublicSubmissions).mockResolvedValue({ items: [mine(21, 'Through the link')], nextCursor: null, totalCount: 1 });
      const renderer = await renderPublic();

      expect(getMyPublicSubmissions).toHaveBeenCalledWith(expect.anything(), 'pub-1', undefined);
      expect(getMyCollectionSubmissions).not.toHaveBeenCalled();
      expect(texts(renderer)).toEqual(expect.arrayContaining(['Through the link', '승인 대기 중']));
    });

    it('a link that was switched off (or is protected) falls back to the safe unavailable message', async () => {
      jest.mocked(getMyPublicSubmissions).mockRejectedValue(new ApiError('notFound', 404, 'gone'));
      expect(texts(await renderPublic())).toContain(i18n.t('sharedCollection.unavailableMessage'));

      jest.mocked(getMyPublicSubmissions).mockRejectedValue(new ApiError('forbidden', 403, 'locked'));
      expect(texts(await renderPublic())).toContain(i18n.t('sharedCollection.unavailableMessage'));
    });
  });
});
