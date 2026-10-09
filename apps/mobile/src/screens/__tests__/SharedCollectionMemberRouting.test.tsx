import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, FlatList, Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ApiError } from '../../api/ApiError';
import { CategoryIconTile } from '../../collections/CategoryIconTile';
import { SharedCollectionScreen } from '../SharedCollectionScreen';
import { getPublicShareMembership } from '../../collections/api/publicShareWriteApi';
import { getPublicCollection, getPublicCollectionItems, unlockPublicCollection } from '../../collections/api/publicCollectionsApi';

const mockRequest = jest.fn();
const mockReplace = jest.fn();
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockCanGoBack = true;
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
  ...jest.requireActual('../../collections/api/publicCollectionsApi'),
  getPublicCollection: jest.fn(),
  getPublicCollectionItems: jest.fn(),
  unlockPublicCollection: jest.fn(),
}));
jest.mock('../../inbox/api/inboxApi', () => ({ saveInboxEntry: jest.fn() }));

const route = { key: 'SharedCollection', name: 'SharedCollection', params: { publicId: 'pub-1' } } as never;
type Renderer = ReactTestRenderer.ReactTestRenderer;
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const allTexts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));

const publicDto = { name: '게임', isLocked: false, permission: 'write', isPublic: true, icon: 'Folder', color: 'blue' };
const privateDto = { name: '비공개 여행', isLocked: false, permission: null, isPublic: false, icon: 'Folder', color: 'blue' };
const notAMember = (isPublic: boolean, joinRequestPending = false) => ({ isMember: false, collectionId: null, role: null, isPublic, joinRequestPending });

/** The dialog the entry shows, found by its title (the common message dialog is a ConfirmDialog too). */
const dialog = (renderer: Renderer, title: string) =>
  renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === title)[0];
const anyEntryDialog = (renderer: Renderer) => [
  i18n.t('sharedCollection.addTitle'),
  i18n.t('sharedCollection.requestTitle'),
  i18n.t('sharedCollection.joinPendingTitle'),
].map(title => dialog(renderer, title)).find(found => found !== undefined);

beforeEach(() => {
  mockIsAuthenticated = true;
  mockCanGoBack = true;
  jest.mocked(getPublicCollection).mockResolvedValue(publicDto as never);
  jest.mocked(getPublicCollectionItems).mockResolvedValue({ items: [], nextCursor: null });
  mockRequest.mockResolvedValue({ status: 200, body: notAMember(true) });
});
afterEach(() => jest.clearAllMocks());

function navigationProp() {
  return { navigate: mockNavigate, replace: mockReplace, goBack: mockGoBack, canGoBack: () => mockCanGoBack } as never;
}

async function renderScreen() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SharedCollectionScreen navigation={navigationProp()} route={route} />);
  });
  return renderer;
}

const calls = (pattern: RegExp) => mockRequest.mock.calls.filter(([options]) => pattern.test(String(options.path)));
const saveCalls = () => calls(/\/save$/);
const requestCalls = () => calls(/\/join-requests$/);

function mockServer(options: { membership: object; save?: object | Error; request?: object | Error }) {
  mockRequest.mockImplementation(async ({ path }: { path: string }) => {
    if (path.endsWith('/membership')) {
      return { status: 200, body: options.membership };
    }
    const result = path.endsWith('/save') ? options.save : options.request;
    if (result instanceof Error) {
      throw result;
    }
    return { status: 200, body: result };
  });
}

async function confirm(renderer: Renderer, title: string) {
  await act(async () => {
    dialog(renderer, title).props.onConfirm();
  });
}

describe('the one resolver for a Collection link (App Link, pasted URL, notification - cold or warm)', () => {
  it.each(['owner', 'contributor', 'submitter', 'viewer'] as const)('a %s goes straight to the normal CollectionDetails - no dialog, no list', async role => {
    mockServer({ membership: { isMember: true, collectionId: 77, role } });
    const renderer = await renderScreen();

    expect(mockRequest).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/public-shares/pub-1/membership' });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 77 });
    expect(anyEntryDialog(renderer)).toBeUndefined();
    expect(saveCalls()).toHaveLength(0);
    expect(requestCalls()).toHaveLength(0);
  });

  it('a membership claim without a Collection id is not enough to navigate', async () => {
    mockServer({ membership: { isMember: true, collectionId: null, role: 'viewer' } });
    await renderScreen();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('PUBLIC nonmember: the 컬렉션 추가 dialog with only the Collection profile - no item list, no URL, nothing is saved by opening', async () => {
    mockServer({ membership: notAMember(true) });
    const renderer = await renderScreen();

    const add = dialog(renderer, i18n.t('sharedCollection.addTitle'));
    expect(add.props.confirmLabel).toBe(i18n.t('common.save'));
    expect(add.props.cancelLabel).toBe(i18n.t('common.cancel'));
    expect(renderer.root.findAllByType(CategoryIconTile)).toHaveLength(1);
    expect(renderer.root.findByType(CategoryIconTile).props).toMatchObject({ icon: 'Folder', color: 'blue' });
    expect(allTexts(renderer)).toContain('게임');
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(0);
    expect(getPublicCollectionItems).not.toHaveBeenCalled();
    expect(saveCalls()).toHaveLength(0);
    expect(requestCalls()).toHaveLength(0);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('PRIVATE nonmember: the 참가 요청 dialog (취소 / 요청) - no item list, nothing requested by opening', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue(privateDto as never);
    mockServer({ membership: notAMember(false) });
    const renderer = await renderScreen();

    const request = dialog(renderer, i18n.t('sharedCollection.requestTitle'));
    expect(request.props.message).toBe(i18n.t('sharedCollection.privateQuestion'));
    expect(request.props.confirmLabel).toBe(i18n.t('sharedCollection.requestSend'));
    expect(request.props.cancelLabel).toBe(i18n.t('common.cancel'));
    expect(dialog(renderer, i18n.t('sharedCollection.addTitle'))).toBeUndefined();
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(0);
    expect(getPublicCollectionItems).not.toHaveBeenCalled();
    expect(saveCalls()).toHaveLength(0);
    expect(requestCalls()).toHaveLength(0);
  });

  it('PRIVATE with a request already waiting: 승인 대기 중 - no request dialog, no second request, no contents', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue(privateDto as never);
    mockServer({ membership: notAMember(false, true) });
    const renderer = await renderScreen();

    const waiting = dialog(renderer, i18n.t('sharedCollection.joinPendingTitle'));
    expect(waiting).toBeDefined();
    expect(waiting.props.cancelLabel).toBeUndefined();
    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
    expect(dialog(renderer, i18n.t('sharedCollection.requestTitle'))).toBeUndefined();
    expect(requestCalls()).toHaveLength(0);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getPublicCollectionItems).not.toHaveBeenCalled();
  });

  it('the resolver never shows the public item-list screen - not even a way to propose a link', async () => {
    mockServer({ membership: notAMember(true) });
    const renderer = await renderScreen();

    expect(exists(renderer, 'shared-collection-add')).toBe(false);
    expect(exists(renderer, 'shared-collection-add-url')).toBe(false);
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../SharedCollectionScreen.tsx'), 'utf8') as string;
    expect(source).not.toMatch(/FlatList|getPublicCollectionItems|usePublicCollectionItems|Linking\.openURL/);
  });

  it('while the membership lookup runs nothing of the dialogs is shown (no flash before a redirect)', async () => {
    let resolveLookup!: (value: unknown) => void;
    mockRequest.mockImplementation((options: { path: string }) =>
      options.path.endsWith('/membership') ? new Promise(resolve => { resolveLookup = resolve; }) : Promise.resolve({ status: 200 }));
    const renderer = await renderScreen();
    expect(anyEntryDialog(renderer)).toBeUndefined();

    await act(async () => {
      resolveLookup({ status: 200, body: { isMember: true, collectionId: 5, role: 'viewer' } });
    });
    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 5 });
  });

  it('a failed membership lookup still resolves from the link itself (a nonmember dialog) - the server has the last word on 저장', async () => {
    mockRequest.mockRejectedValue(new Error('network'));
    const renderer = await renderScreen();

    expect(mockReplace).not.toHaveBeenCalled();
    expect(dialog(renderer, i18n.t('sharedCollection.addTitle'))).toBeDefined();
  });

  it('signed out: no membership call, no save, no request - just a sign-in notice over the profile', async () => {
    mockIsAuthenticated = false;
    const renderer = await renderScreen();

    expect(mockRequest).not.toHaveBeenCalled();
    const notice = dialog(renderer, i18n.t('sharedCollection.addTitle'));
    expect(notice.props.message).toBe(i18n.t('sharedCollection.signInRequired'));
    expect(notice.props.cancelLabel).toBeUndefined();
  });

  it('an unknown or revoked link is one "unavailable" state', async () => {
    jest.mocked(getPublicCollection).mockRejectedValue(new ApiError('notFound', 404));
    mockServer({ membership: notAMember(true) });
    const renderer = await renderScreen();

    expect(allTexts(renderer)).toContain(i18n.t('sharedCollection.unavailableTitle'));
    expect(anyEntryDialog(renderer)).toBeUndefined();
  });
});

describe('컬렉션 추가 (a public Collection)', () => {
  beforeEach(() => mockServer({ membership: notAMember(true), save: { outcome: 'joined', collectionId: 33, role: 'viewer' } }));

  it('취소 saves nothing and goes back', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      dialog(renderer, i18n.t('sharedCollection.addTitle')).props.onCancel();
    });

    expect(saveCalls()).toHaveLength(0);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('취소 on a cold start (nothing to go back to) lands on Home', async () => {
    mockCanGoBack = false;
    const renderer = await renderScreen();

    await act(async () => {
      dialog(renderer, i18n.t('sharedCollection.addTitle')).props.onCancel();
    });

    expect(mockNavigate).toHaveBeenCalledWith('MainTabs');
  });

  it('저장 sends one body-less POST (no role, no user), then opens the normal CollectionDetails', async () => {
    const renderer = await renderScreen();

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(saveCalls().map(([options]) => options)).toEqual([{ method: 'POST', path: '/api/v1/public-shares/pub-1/save' }]);
    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 33 });
    expect(requestCalls()).toHaveLength(0);
  });

  it('a second tap while the save runs sends nothing more', async () => {
    let release!: (value: unknown) => void;
    mockRequest.mockImplementation(({ path }: { path: string }) =>
      path.endsWith('/membership') ? Promise.resolve({ status: 200, body: notAMember(true) }) : new Promise(resolve => { release = resolve; }));
    const renderer = await renderScreen();

    await act(async () => {
      const add = dialog(renderer, i18n.t('sharedCollection.addTitle'));
      add.props.onConfirm();
      add.props.onConfirm();
    });

    expect(saveCalls()).toHaveLength(1);
    await act(async () => {
      release({ status: 200, body: { outcome: 'joined', collectionId: 33, role: 'viewer' } });
    });
  });

  it('already a member by the time of 저장: the same outcome - straight to the Collection', async () => {
    mockServer({ membership: notAMember(true), save: { outcome: 'alreadyMember', collectionId: 33, role: 'contributor' } });
    const renderer = await renderScreen();

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 33 });
  });

  it('the Owner switched 공용 컬렉션 OFF while the dialog was open: nothing is saved, it says so, and the dialog becomes the 참가 요청 one', async () => {
    mockServer({ membership: notAMember(true), save: new ApiError('conflict', 409, 'joinNotAllowed') });
    const renderer = await renderScreen();
    jest.mocked(getPublicCollection).mockResolvedValue(privateDto as never);

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(renderer.root.findAll(node => node.type === Modal && node.props.visible === true)
      .flatMap(modal => modal.findAllByType(Text).map(text => String(text.props.children)))).toContain(i18n.t('sharedCollection.joinNotAllowed'));
    expect(dialog(renderer, i18n.t('sharedCollection.requestTitle'))).toBeDefined();
  });

  it('a revoked link is said plainly', async () => {
    mockServer({ membership: notAMember(true), save: new ApiError('notFound', 404) });
    const renderer = await renderScreen();

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(saveCalls()).toHaveLength(1);
  });
});

describe('참가 요청 (a private Collection)', () => {
  beforeEach(() => {
    jest.mocked(getPublicCollection).mockResolvedValue(privateDto as never);
    mockServer({ membership: notAMember(false), request: { outcome: 'requested', collectionId: null, role: null } });
  });

  it('취소 requests nothing and goes back', async () => {
    const renderer = await renderScreen();

    await act(async () => {
      dialog(renderer, i18n.t('sharedCollection.requestTitle')).props.onCancel();
    });

    expect(requestCalls()).toHaveLength(0);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('요청 sends one body-less POST, then the view becomes 승인 대기 중 - still no membership, no contents', async () => {
    const renderer = await renderScreen();

    await confirm(renderer, i18n.t('sharedCollection.requestTitle'));

    expect(requestCalls().map(([options]) => options)).toEqual([{ method: 'POST', path: '/api/v1/public-shares/pub-1/join-requests' }]);
    expect(saveCalls()).toHaveLength(0);
    expect(dialog(renderer, i18n.t('sharedCollection.joinPendingTitle'))).toBeDefined();
    expect(dialog(renderer, i18n.t('sharedCollection.requestTitle'))).toBeUndefined();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getPublicCollectionItems).not.toHaveBeenCalled();
  });

  it('the pending view closes with 확인 (back), nothing else is offered', async () => {
    const renderer = await renderScreen();
    await confirm(renderer, i18n.t('sharedCollection.requestTitle'));

    await act(async () => {
      dialog(renderer, i18n.t('sharedCollection.joinPendingTitle')).props.onConfirm();
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(requestCalls()).toHaveLength(1);
  });

  it('a request an Owner already answered or made obsolete is not shown as waiting: the dialog asks again and it is a fresh request', async () => {
    const renderer = await renderScreen();
    expect(dialog(renderer, i18n.t('sharedCollection.joinPendingTitle'))).toBeUndefined();

    await confirm(renderer, i18n.t('sharedCollection.requestTitle'));
    expect(requestCalls()).toHaveLength(1);
  });

  it('the Owner switched 공용 컬렉션 ON meanwhile (409): it says so and the dialog becomes 컬렉션 추가', async () => {
    mockServer({ membership: notAMember(false), request: new ApiError('conflict', 409, 'joinNotAllowed') });
    const renderer = await renderScreen();
    jest.mocked(getPublicCollection).mockResolvedValue(publicDto as never);

    await confirm(renderer, i18n.t('sharedCollection.requestTitle'));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(dialog(renderer, i18n.t('sharedCollection.addTitle'))).toBeDefined();
  });

  it('a second tap while a request runs sends nothing more', async () => {
    let release!: (value: unknown) => void;
    mockRequest.mockImplementation(({ path }: { path: string }) =>
      path.endsWith('/membership') ? Promise.resolve({ status: 200, body: notAMember(false) }) : new Promise(resolve => { release = resolve; }));
    const renderer = await renderScreen();

    await act(async () => {
      const request = dialog(renderer, i18n.t('sharedCollection.requestTitle'));
      request.props.onConfirm();
      request.props.onConfirm();
    });

    expect(requestCalls()).toHaveLength(1);
    await act(async () => {
      release({ status: 200, body: { outcome: 'requested', collectionId: null, role: null } });
    });
  });

  it('once approved, the next resolution of the link is a member: CollectionDetails', async () => {
    mockServer({ membership: { isMember: true, collectionId: 33, role: 'viewer' } });
    await renderScreen();

    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 33 });
  });
});

describe('the Collection own profile in the dialogs (the same tile priority as everywhere else in Juple)', () => {
  const photo = { iconImageUrl: 'https://blob.test/cover?sig=1', iconImageVersion: 'v1' };
  const tile = (renderer: Renderer) => renderer.root.findByType(CategoryIconTile).props;

  it('컬렉션 추가: the custom profile image is handed to the tile (image first), together with the icon and color it falls back to', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ ...publicDto, ...photo } as never);
    mockServer({ membership: notAMember(true) });
    const renderer = await renderScreen();

    expect(tile(renderer)).toMatchObject({ imageUrl: photo.iconImageUrl, imageVersion: 'v1', icon: 'Folder', color: 'blue' });
  });

  it('참가 요청: the same custom image, the same tile', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ ...privateDto, ...photo } as never);
    mockServer({ membership: notAMember(false) });
    const renderer = await renderScreen();

    expect(tile(renderer)).toMatchObject({ imageUrl: photo.iconImageUrl, imageVersion: 'v1' });
  });

  it('승인 대기 중: the image stays under the dim and the spinner - a pending Collection is not replaced by a generic icon', async () => {
    jest.mocked(getPublicCollection).mockResolvedValue({ ...privateDto, ...photo } as never);
    mockServer({ membership: notAMember(false, true) });
    const renderer = await renderScreen();

    expect(tile(renderer)).toMatchObject({ imageUrl: photo.iconImageUrl, imageVersion: 'v1' });
    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('without a photo: the configured icon and color; with neither: the default folder - no image is invented', async () => {
    mockServer({ membership: notAMember(true) });
    expect(tile(await renderScreen())).toMatchObject({ imageUrl: null, imageVersion: null, icon: 'Folder', color: 'blue' });

    jest.mocked(getPublicCollection).mockResolvedValue({ name: '이름뿐', isLocked: false, permission: 'read', isPublic: true } as never);
    expect(tile(await renderScreen())).toMatchObject({ imageUrl: null, icon: 'Folder', color: null });
  });

  it('every surface keys the tile the same way (one key per share link, never a real Collection id), so the photo is not reloaded between them', async () => {
    const { shareEntryTileKey } = require('../../collections/shareEntryTileKey');
    mockServer({ membership: notAMember(true) });
    const renderer = await renderScreen();

    expect(tile(renderer).collectionId).toBe(shareEntryTileKey('pub-1'));
    expect(shareEntryTileKey('pub-1')).toBeLessThan(0);
    expect(shareEntryTileKey('pub-1')).toBe(shareEntryTileKey('pub-1'));
    expect(shareEntryTileKey('pub-1')).not.toBe(shareEntryTileKey('pub-2'));
  });
});

describe('getPublicShareMembership', () => {
  it('returns the body, and null for an unknown or revoked link', async () => {
    mockRequest.mockResolvedValueOnce({ status: 200, body: { isMember: true, collectionId: 9, role: 'owner' } });
    await expect(getPublicShareMembership(mockRequest, 'a/b')).resolves.toEqual({ isMember: true, collectionId: 9, role: 'owner' });
    expect(mockRequest).toHaveBeenLastCalledWith({ method: 'GET', path: '/api/v1/public-shares/a%2Fb/membership' });

    mockRequest.mockRejectedValueOnce(new ApiError('notFound', 404, 'gone'));
    await expect(getPublicShareMembership(mockRequest, 'gone')).resolves.toBeNull();
  });
});

describe('a password-protected link (mobile unlock)', () => {
  const GRANT = 'grant-token-for-pub-1';
  const byId = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID)[0];
  const press = async (renderer: Renderer, testID: string) => {
    await act(async () => {
      await byId(renderer, testID).props.onPress();
    });
  };
  const type = async (renderer: Renderer, value: string) => {
    await act(async () => {
      byId(renderer, 'shared-collection-unlock-password').props.onChangeText(value);
    });
  };
  const lockedDto = { name: null, isLocked: true, permission: null };

  beforeEach(() => {
    jest.mocked(getPublicCollection).mockImplementation(async (_id: string, token?: string) => (token === GRANT ? { ...publicDto, isLocked: true } : lockedDto) as never);
    jest.mocked(unlockPublicCollection).mockImplementation(async (_id: string, password: string) => {
      if (password === 'wrong') {
        throw new ApiError('forbidden', 403, 'invalidCollectionPassword');
      }
      if (password === 'flood') {
        throw new ApiError('tooManyRequests', 429);
      }
      return { unlockToken: GRANT, expiresAtUtc: '2026-10-09T01:00:00Z' };
    });
    mockServer({ membership: notAMember(true), save: { outcome: 'joined', collectionId: 8, role: 'viewer' }, request: { outcome: 'requested', collectionId: null, role: null } });
  });

  it('shows a neutral locked state: no name, no dialog, nothing offered', async () => {
    const renderer = await renderScreen();

    expect(exists(renderer, 'shared-collection-locked')).toBe(true);
    expect(anyEntryDialog(renderer)).toBeUndefined();
    expect(allTexts(renderer)).not.toContain('게임');
  });

  it('the field is a secure password field that never autofills or autocorrects', async () => {
    const renderer = await renderScreen();
    const field = byId(renderer, 'shared-collection-unlock-password');

    expect(field.props.secureTextEntry).toBe(true);
    expect(field.props.autoCorrect).toBe(false);
    expect(field.props.importantForAutofill).toBe('no');
  });

  it('a wrong password stays locked, says so inline next to the field, and clears what was typed', async () => {
    const renderer = await renderScreen();

    await type(renderer, 'wrong');
    await press(renderer, 'shared-collection-unlock');

    expect(unlockPublicCollection).toHaveBeenCalledWith('pub-1', 'wrong');
    expect(exists(renderer, 'shared-collection-locked')).toBe(true);
    expect(byId(renderer, 'shared-collection-unlock-error').props.children).toBe(i18n.t('sharedCollection.wrongPassword'));
    expect(byId(renderer, 'shared-collection-unlock-password').props.value).toBe('');
  });

  it('throttling is said in words; any other failure goes to the common centered dialog', async () => {
    const renderer = await renderScreen();
    await type(renderer, 'flood');
    await press(renderer, 'shared-collection-unlock');
    expect(byId(renderer, 'shared-collection-unlock-error').props.children).toBe(i18n.t('sharedCollection.tooManyAttempts'));

    jest.mocked(unlockPublicCollection).mockRejectedValueOnce(new Error('network'));
    await type(renderer, 'anything');
    await press(renderer, 'shared-collection-unlock');
    const shown = renderer.root.findAll(node => node.type === Modal && node.props.visible === true).flatMap(modal => modal.findAllByType(Text).map(text => String(text.props.children)));
    expect(shown).toContain(i18n.t('sharedCollection.unlockFailed'));
  });

  it('PUBLIC + password: the right password reveals only the 컬렉션 추가 dialog - the password alone saves nothing, and 저장 carries the grant in the header only', async () => {
    const renderer = await renderScreen();

    await type(renderer, 'right-password');
    await press(renderer, 'shared-collection-unlock');

    expect(exists(renderer, 'shared-collection-locked')).toBe(false);
    expect(dialog(renderer, i18n.t('sharedCollection.addTitle'))).toBeDefined();
    expect(saveCalls()).toHaveLength(0);
    expect(getPublicCollectionItems).not.toHaveBeenCalled();

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(saveCalls()[0][0]).toEqual({ method: 'POST', path: '/api/v1/public-shares/pub-1/save', headers: { 'X-Juple-Collection-Unlock': GRANT } });
    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 8 });
    expect(JSON.stringify(mockRequest.mock.calls)).not.toContain('right-password');
  });

  it('PRIVATE + password: the right password reveals only the 참가 요청 dialog - no automatic request, and 요청 carries the grant', async () => {
    jest.mocked(getPublicCollection).mockImplementation(async (_id: string, token?: string) => (token === GRANT ? { ...privateDto, isLocked: true } : lockedDto) as never);
    mockServer({ membership: notAMember(false), request: { outcome: 'requested', collectionId: null, role: null } });
    const renderer = await renderScreen();

    await type(renderer, 'right-password');
    await press(renderer, 'shared-collection-unlock');

    expect(dialog(renderer, i18n.t('sharedCollection.requestTitle'))).toBeDefined();
    expect(requestCalls()).toHaveLength(0);

    await confirm(renderer, i18n.t('sharedCollection.requestTitle'));

    expect(requestCalls()[0][0]).toEqual({ method: 'POST', path: '/api/v1/public-shares/pub-1/join-requests', headers: { 'X-Juple-Collection-Unlock': GRANT } });
    expect(getPublicCollectionItems).not.toHaveBeenCalled();
  });

  it('a member of a protected link never meets the password screen: straight to the normal Collection and its own lock', async () => {
    mockServer({ membership: { isMember: true, collectionId: 77, role: 'viewer' } });
    const renderer = await renderScreen();

    expect(mockReplace).toHaveBeenCalledWith('CollectionDetails', { collectionId: 77 });
    expect(exists(renderer, 'shared-collection-unlock-password')).toBe(false);
  });

  it('a grant that stops working sends the person back to the locked state', async () => {
    const renderer = await renderScreen();
    await type(renderer, 'right-password');
    await press(renderer, 'shared-collection-unlock');
    mockServer({ membership: notAMember(true), save: new ApiError('forbidden', 403, 'collectionLocked') });
    jest.mocked(getPublicCollection).mockImplementation(async () => lockedDto as never);

    await confirm(renderer, i18n.t('sharedCollection.addTitle'));

    expect(exists(renderer, 'shared-collection-locked')).toBe(true);
  });

  it('a signed-out visitor can still unlock, and then only gets the sign-in notice', async () => {
    mockIsAuthenticated = false;
    const renderer = await renderScreen();
    await type(renderer, 'right-password');
    await press(renderer, 'shared-collection-unlock');

    expect(dialog(renderer, i18n.t('sharedCollection.addTitle')).props.message).toBe(i18n.t('sharedCollection.signInRequired'));
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
