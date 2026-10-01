import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { SharedCollectionScreen } from '../SharedCollectionScreen';
import { getPublicCollection, getPublicCollectionItems } from '../../collections/api/publicCollectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';

const mockRequest = jest.fn();
let mockIsAuthenticated = true;

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
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: mockIsAuthenticated }) }));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../collections/api/publicCollectionsApi', () => ({
  getPublicCollection: jest.fn(),
  getPublicCollectionItems: jest.fn(),
}));
jest.mock('../../inbox/api/inboxApi', () => ({ saveInboxEntry: jest.fn() }));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const route = { key: 'SharedCollection', name: 'SharedCollection', params: { publicId: 'pub-1' } } as never;
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const byId = (renderer: Renderer, testID: string) => renderer.root.findByProps({ testID });

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  mockIsAuthenticated = true;
  jest.mocked(getPublicCollection).mockResolvedValue({ name: '모두의 여행지', isLocked: false, permission: 'write' });
  jest.mocked(getPublicCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
  jest.mocked(saveInboxEntry).mockResolvedValue({ id: 42, url: 'https://example.test/a', savedAtUtc: '' });
  mockRequest.mockResolvedValue({ status: 204 });
});

afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SharedCollectionScreen navigation={{} as never} route={route} />);
  });
  return renderer;
}

describe('SharedCollectionScreen - 모든 사용자: 작성', () => {
  it('a signed-in viewer saves the link to their own library first, then adds it through the link - and the list reloads', async () => {
    const renderer = await renderScreen();
    expect(getPublicCollectionItems).toHaveBeenCalledTimes(1);

    await act(async () => {
      byId(renderer, 'shared-collection-add-url').props.onChangeText(' https://example.test/a ');
    });
    await act(async () => {
      await byId(renderer, 'shared-collection-add-submit').props.onPress();
    });

    expect(saveInboxEntry).toHaveBeenCalledWith(mockRequest, 'https://example.test/a');
    expect(mockRequest).toHaveBeenCalledWith({ method: 'PUT', path: '/api/v1/public-shares/pub-1/items/42' });
    expect(getPublicCollectionItems).toHaveBeenCalledTimes(2);
    expect(byId(renderer, 'shared-collection-add-url').props.value).toBe('');
    expect(byId(renderer, 'shared-collection-add').findAllByType(Text).map(node => String(node.props.children)))
      .toEqual(expect.arrayContaining([i18n.t('sharedCollection.addVisibilityNote'), i18n.t('sharedCollection.addDone')]));
  });

  it('signed out, there is no way to add - only the sign-in note (never an anonymous write)', async () => {
    mockIsAuthenticated = false;
    const renderer = await renderScreen();

    expect(exists(renderer, 'shared-collection-add-url')).toBe(false);
    expect(exists(renderer, 'shared-collection-add-sign-in')).toBe(true);
    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a read-only link, or a locked one, shows no add area at all', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ name: '읽기 전용', isLocked: false, permission: 'read' });
    let renderer = await renderScreen();
    expect(exists(renderer, 'shared-collection-add')).toBe(false);

    jest.mocked(getPublicCollection).mockResolvedValue({ name: null, isLocked: true, permission: null });
    renderer = await renderScreen();
    expect(exists(renderer, 'shared-collection-add')).toBe(false);
  });

  it('승인 후 추가: a signed-in viewer proposes the link - it waits for the Owner, so the list does not change', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ name: '모두의 여행지', isLocked: false, permission: 'submit' });
    mockRequest.mockResolvedValue({ status: 202, body: { submitted: true } });
    const renderer = await renderScreen();
    expect(byId(renderer, 'shared-collection-add').findAllByType(Text).map(node => String(node.props.children)))
      .toContain(i18n.t('sharedCollection.addSubmitNote'));

    await act(async () => {
      byId(renderer, 'shared-collection-add-url').props.onChangeText('https://example.test/a');
    });
    await act(async () => {
      await byId(renderer, 'shared-collection-add-submit').props.onPress();
    });

    expect(mockRequest).toHaveBeenCalledWith({ method: 'PUT', path: '/api/v1/public-shares/pub-1/items/42' });
    expect(byId(renderer, 'shared-collection-add-message').props.children).toBe('승인 요청을 보냈어요.');
    // Nothing new to show: not reloaded.
    expect(getPublicCollectionItems).toHaveBeenCalledTimes(1);
  });

  it('승인 후 추가: a link already there, or already waiting, says so', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ name: '모두의 여행지', isLocked: false, permission: 'submit' });
    mockRequest.mockRejectedValue(new ApiError('conflict', 409, 'linkAlreadyInCollection'));
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'shared-collection-add-url').props.onChangeText('https://example.test/a');
    });
    await act(async () => {
      await byId(renderer, 'shared-collection-add-submit').props.onPress();
    });

    expect(byId(renderer, 'shared-collection-add-message').props.children).toBe('이미 컬렉션에 있는 링크예요.');
  });

  it('a link switched to read-only in the meantime explains it cannot add right now', async () => {
    mockRequest.mockRejectedValue(new ApiError('forbidden', 403, 'publicShareReadOnly'));
    const renderer = await renderScreen();
    await act(async () => {
      byId(renderer, 'shared-collection-add-url').props.onChangeText('https://example.test/a');
    });
    await act(async () => {
      await byId(renderer, 'shared-collection-add-submit').props.onPress();
    });

    expect(byId(renderer, 'shared-collection-add-message').props.children).toBe(i18n.t('sharedCollection.addNotAllowed'));
  });
});
