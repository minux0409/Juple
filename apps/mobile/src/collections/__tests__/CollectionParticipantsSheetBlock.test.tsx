import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CollectionParticipantsSheet } from '../CollectionParticipantsSheet';

const mockApi = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockApi }));
jest.mock('../../friends/PersonProfileModal', () => ({ usePersonProfile: () => ({ openProfile: jest.fn(), profileModal: null }) }));
jest.mock('../../settings/viewModePreference', () => ({ useViewModePreference: () => ({ viewMode: 'list', changeViewMode: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const data = {
  canManage: false,
  participants: [
    { jupleId: 'MEME2345', displayName: 'Me', role: 'viewer', isMe: true },
    { jupleId: 'OWNR2345', displayName: 'Owner', role: 'owner', isMe: false },
  ],
  pendingInvitations: [],
};

async function renderSheet() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionParticipantsSheet authenticatedRequest={jest.fn().mockResolvedValue({ body: data }) as never} collectionId={1} initialData={data as never} onClose={jest.fn()} visible />,
    );
  });
  return renderer;
}
const more = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) =>
  renderer.root.findAll(node => node.props.testID === `participants-sheet-more-${id}` && typeof node.props.onPress === 'function');

const BLOCKED_PATH = '/api/v1/users/me/blocked-users';
/** The server's list of people I blocked, and a generic 204 for everything else. */
function serverBlocks(blockedIds: readonly string[]) {
  mockApi.mockImplementation(async (request: { method: string; path: string }) =>
    request.path === BLOCKED_PATH ? { body: { items: blockedIds.map(jupleId => ({ jupleId })) } } : { body: undefined });
}
const writes = () => mockApi.mock.calls.filter(([request]) => request.path !== BLOCKED_PATH);
const openMenu = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
  await act(async () => more(renderer, 'OWNR2345')[0].props.onPress());
  return renderer.root.findAll(node => Array.isArray(node.props.actions) && node.props.visible === true)[0];
};

describe('사용자 차단 from the participant list', () => {
  beforeEach(() => {
    mockApi.mockReset();
    serverBlocks([]);
  });

  it('every other person has a "⋯" - the Owner too - and my own row has none', async () => {
    const renderer = await renderSheet();
    expect(more(renderer, 'OWNR2345').length).toBeGreaterThan(0);
    expect(more(renderer, 'MEME2345')).toHaveLength(0);
  });

  it('nothing is blocked before the question is answered; then only the block request is sent', async () => {
    const renderer = await renderSheet();
    await act(async () => more(renderer, 'OWNR2345')[0].props.onPress());
    const menu = renderer.root.findAll(node => Array.isArray(node.props.actions) && node.props.visible === true)[0];
    await act(async () => {
      menu.props.actions[0].onPress();
      menu.props.onDismiss?.();
    });
    expect(writes()).toHaveLength(0);

    const dialog = renderer.root.findAll(node => node.props.visible === true && typeof node.props.onConfirm === 'function' && node.props.confirmLabel === i18n.t('safety.block'))[0];
    await act(async () => dialog.props.onConfirm());
    expect(writes()).toEqual([[{ method: 'POST', path: '/api/v1/users/OWNR2345/block' }]]);
  });

  it('an already blocked person gets 차단 해제 - no block question, and only the unblock request is sent', async () => {
    serverBlocks(['OWNR2345']);
    const renderer = await renderSheet();
    const menu = await openMenu(renderer);
    expect(menu.props.actions[0].label).toBe(i18n.t('safety.unblock'));
    expect(menu.props.actions[0].disabled).toBe(false);
    await act(async () => {
      menu.props.actions[0].onPress();
      menu.props.onDismiss?.();
    });
    expect(renderer.root.findAll(node => node.props.visible === true && node.props.confirmLabel === i18n.t('safety.block'))).toHaveLength(0);
    expect(writes()).toEqual([[{ method: 'DELETE', path: '/api/v1/users/OWNR2345/block' }]]);
  });

  it('while the server has not said who is blocked the action cannot start a block', async () => {
    mockApi.mockImplementation(() => new Promise(() => undefined));
    const renderer = await renderSheet();
    const menu = await openMenu(renderer);
    expect(menu.props.actions[0].disabled).toBe(true);
    await act(async () => {
      menu.props.actions[0].onPress();
      menu.props.onDismiss?.();
    });
    expect(renderer.root.findAll(node => node.props.visible === true && node.props.confirmLabel === i18n.t('safety.block'))).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });
});
