import ReactTestRenderer, { act } from 'react-test-renderer';
import '../../i18n';
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

describe('사용자 차단 from the participant list', () => {
  beforeEach(() => mockApi.mockReset());

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
    expect(mockApi).not.toHaveBeenCalled();

    const dialog = renderer.root.findAll(node => node.props.visible === true && typeof node.props.onConfirm === 'function' && String(node.props.message).includes('Owner'))[0];
    mockApi.mockResolvedValue({ body: undefined });
    await act(async () => dialog.props.onConfirm());
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/users/OWNR2345/block' });
  });
});
