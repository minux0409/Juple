import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { JoinRequestsSheet } from '../../collections/JoinRequestsSheet';
import { AppToastProvider } from '../../components/AppToast';
import { CollectionDetailsScreen } from '../CollectionDetailsScreen';
import { getCollection, getCollectionItemSections, getCollectionItems, type Collection } from '../../collections/api/collectionsApi';
import { markCollectionNewLinksRead } from '../../notifications/notificationsApi';
import { getUnreadCount, resetNotificationState, subscribeCollectionNewLinksRead } from '../../notifications/notificationState';

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
  getCollection: jest.fn(),
  getCollectionItems: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  getCollectionItemSections: jest.fn().mockResolvedValue([]),
  getCollectionParticipants: jest.fn().mockResolvedValue({ participants: [], pendingInvitations: [], canManage: false }),
  getCollectionNotificationPreference: jest.fn().mockResolvedValue({ newItemNotificationsEnabled: true }),
  getCollectionShareLink: jest.fn().mockResolvedValue(null),
  MAX_ITEMS_PER_COPY: 200,
}));
jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getCollectionParticipants: jest.fn().mockResolvedValue({ participants: [], pendingInvitations: [], canManage: false }),
}));
jest.mock('../../notifications/notificationsApi', () => ({
  ...jest.requireActual('../../notifications/notificationsApi'),
  markCollectionNewLinksRead: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
  resetNotificationState();
});

function collection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 1,
    name: '여행',
    isFavorite: false,
    itemCount: 1,
    createdAtUtc: new Date().toISOString(),
    updatedAtUtc: new Date().toISOString(),
    icon: 'Folder',
    color: null,
    accessRole: 'contributor',
    ownerJupleId: 'K7MP4Q8N',
    ...overrides,
  };
}

async function renderScreen(params: Record<string, unknown>) {
  const navigation = { navigate: jest.fn(), setParams: jest.fn(), goBack: jest.fn(), replace: jest.fn(), popTo: jest.fn(), setOptions: jest.fn() };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <CollectionDetailsScreen
          navigation={navigation as never}
          route={{ key: 'CollectionDetails', name: 'CollectionDetails', params: { collectionId: 1, ...params } } as never}
        />
      </AppToastProvider>,
    );
  });
  await act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
  mounted.push(renderer);
  return navigation;
}

describe('CollectionDetailsScreen - notifications', () => {
  it('once its content is open, reads the Collection\'s 새 링크 notifications (approvals untouched) and tells the Collections list', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection());
    jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 3, unreadCount: 4 });
    const cleared: number[] = [];
    const unsubscribe = subscribeCollectionNewLinksRead(id => cleared.push(id));

    await renderScreen({});
    unsubscribe();

    expect(markCollectionNewLinksRead).toHaveBeenCalledWith(expect.any(Function), 1);
    expect(getUnreadCount()).toBe(4);
    expect(cleared).toEqual([1]);
  });

  it('behind its lock / share password nothing is read and no link is opened', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection({ isSharePasswordProtected: true }));
    jest.mocked(getCollectionItemSections).mockRejectedValueOnce(new ApiError('forbidden', 403, 'sharePasswordRequired'));
    jest.mocked(getCollectionItems).mockRejectedValueOnce(new ApiError('forbidden', 403, 'sharePasswordRequired'));

    const navigation = await renderScreen({ openItem: { itemId: 9, focus: 'comments' } });

    expect(markCollectionNewLinksRead).not.toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('ItemDetails', expect.anything());
  });

  it('a reply notification on my own link opens it with its thread to open', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection());
    jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 0, unreadCount: 0 });

    const navigation = await renderScreen({ openItem: { itemId: 9, focus: 'comments', commentRootId: 41 } });

    expect(navigation.navigate).toHaveBeenCalledWith('ItemDetails', {
      itemId: 9,
      collectionContext: { collectionId: 1, canRemove: true, isCollectionOwner: false, isCollaborative: true },
      initialFocus: 'comments',
      initialFocusThreadRootId: 41,
    });
  });

  it('a reply or heart on my comment under somebody else link opens the read-only shared view, thread open - once', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection());
    jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 0, unreadCount: 0 });

    const navigation = await renderScreen({ openItem: { itemId: 9, focus: 'comments', commentRootId: 41, shared: true } });

    expect(navigation.setParams).toHaveBeenCalledWith({ openItem: undefined });
    expect(navigation.navigate).toHaveBeenCalledWith('CollectionSharedItem', {
      collectionId: 1,
      itemId: 9,
      isCollectionOwner: false,
      focusThreadRootId: 41,
    });
    expect(navigation.navigate).not.toHaveBeenCalledWith('ItemDetails', expect.anything());
    expect(jest.mocked(navigation.navigate).mock.calls.filter(([name]) => name === 'CollectionSharedItem')).toHaveLength(1);
  });

  it('a comment notification opens my link IN this Collection, scrolled to its comments - once', async () => {
    jest.mocked(getCollection).mockResolvedValue(collection());
    jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 0, unreadCount: 0 });

    const navigation = await renderScreen({ openItem: { itemId: 9, focus: 'comments' } });

    expect(navigation.setParams).toHaveBeenCalledWith({ openItem: undefined });
    expect(navigation.navigate).toHaveBeenCalledWith('ItemDetails', {
      itemId: 9,
      collectionContext: { collectionId: 1, canRemove: true, isCollectionOwner: false, isCollaborative: true },
      initialFocus: 'comments',
    });
    expect(jest.mocked(navigation.navigate).mock.calls.filter(([name]) => name === 'ItemDetails')).toHaveLength(1);
  });

  describe('a 참여 요청 notification (openJoinRequests)', () => {
    /** The 참여 요청 bottom sheet of the screen just rendered, and any navigation to a management screen (there is none any more). */
    const sheetOf = () => ({ props: { visible: mounted[mounted.length - 1].root.findAllByType(JoinRequestsSheet).some(sheet => sheet.props.visible === true) } });
    const managementNavigations = (navigation: Awaited<ReturnType<typeof renderScreen>>) =>
      jest.mocked(navigation.navigate).mock.calls.filter(([name]) => name === 'CollectionJoinRequests' || name === 'CollectionShare');

    it('an unlocked Collection of mine opens the 참여 요청 bottom sheet over it - once, with no navigation', async () => {
      jest.mocked(getCollection).mockResolvedValue(collection({ accessRole: 'owner' }));
      jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 0, unreadCount: 0 });

      const navigation = await renderScreen({ openJoinRequests: true });

      expect(navigation.setParams).toHaveBeenCalledWith({ openJoinRequests: undefined });
      expect(sheetOf().props.visible).toBe(true);
      expect(managementNavigations(navigation)).toHaveLength(0);
    });

    it('behind its lock / share password the gate comes first and no sheet opens', async () => {
      jest.mocked(getCollection).mockResolvedValue(collection({ accessRole: 'owner', isLocked: true }));
      jest.mocked(getCollectionItemSections).mockRejectedValueOnce(new ApiError('forbidden', 403, 'collectionLocked'));
      jest.mocked(getCollectionItems).mockRejectedValueOnce(new ApiError('forbidden', 403, 'collectionLocked'));

      const navigation = await renderScreen({ openJoinRequests: true });

      expect(sheetOf().props.visible).toBe(false);
      expect(managementNavigations(navigation)).toHaveLength(0);
      expect(navigation.setParams).not.toHaveBeenCalledWith({ openJoinRequests: undefined }); // still pending: it waits for the gate
    });

    it('a Collection that is gone, or not mine to manage, opens nothing', async () => {
      jest.mocked(getCollection).mockRejectedValue(new ApiError('notFound', 404));
      const gone = await renderScreen({ openJoinRequests: true });
      expect(managementNavigations(gone)).toHaveLength(0);
      expect(sheetOf().props.visible).toBe(false);

      jest.mocked(getCollection).mockResolvedValue(collection({ accessRole: 'contributor' }));
      jest.mocked(markCollectionNewLinksRead).mockResolvedValue({ markedCount: 0, unreadCount: 0 });
      const member = await renderScreen({ openJoinRequests: true });
      expect(managementNavigations(member)).toHaveLength(0);
      expect(sheetOf().props.visible).toBe(false);
    });
  });
});
