import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { PersonProfileModal } from '../PersonProfileModal';

const mockApi = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockApi }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

const BLOCKED_PATH = '/api/v1/users/me/blocked-users';
let blockedIds: string[] = [];
const writes = () => mockApi.mock.calls.filter(([request]) => request.path !== BLOCKED_PATH);

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  blockedIds = [];
  mockApi.mockReset();
  mockApi.mockImplementation(async (request: { method: string; path: string }) => {
    if (request.path === BLOCKED_PATH) {
      return { body: { items: blockedIds.map(jupleId => ({ jupleId })) } };
    }
    if (request.method === 'POST' && request.path.endsWith('/block')) {
      blockedIds = ['ABCD2345'];
    }
    if (request.method === 'DELETE' && request.path.endsWith('/block')) {
      blockedIds = [];
    }
    return { body: undefined };
  });
});

async function mount(relationship: 'available' | 'unknown' = 'available') {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <PersonProfileModal onClose={jest.fn()} onRequestSent={jest.fn()} onRetry={jest.fn()} onStale={jest.fn()} person={{ jupleId: 'ABCD2345', displayName: '꼬부기' }} relationship={relationship} />,
    );
  });
  const has = (testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
  const press = async (testID: string) => {
    const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
    await act(async () => target.props.onPress());
  };
  return { renderer, has, press };
}

describe('PersonProfileModal - blocked state', () => {
  it('a person I have not blocked: 친구 요청 보내기, 신고 and 차단', async () => {
    const { has } = await mount();
    expect(has('person-profile-send')).toBe(true);
    expect(has('person-profile-report')).toBe(true);
    expect(has('person-profile-block')).toBe(true);
    expect(has('person-profile-unblock')).toBe(false);
  });

  it('a person I already blocked: no friend request, 신고 stays, 차단 해제 replaces 차단', async () => {
    blockedIds = ['ABCD2345'];
    const { has } = await mount();
    expect(has('person-profile-send')).toBe(false);
    expect(has('person-profile-report')).toBe(true);
    expect(has('person-profile-block')).toBe(false);
    expect(has('person-profile-unblock')).toBe(true);
  });

  it('blocking refreshes the open profile at once (no close), unblocking brings the friend request back', async () => {
    const { renderer, has, press } = await mount();
    await press('person-profile-block');
    const dialog = renderer.root.findAll(node => node.props.visible === true && node.props.confirmLabel === i18n.t('safety.block'))[0];
    await act(async () => dialog.props.onConfirm());
    expect(writes()).toEqual([[{ method: 'POST', path: '/api/v1/users/ABCD2345/block' }]]);
    expect(has('person-profile')).toBe(true);
    expect(has('person-profile-unblock')).toBe(true);
    expect(has('person-profile-send')).toBe(false);

    await press('person-profile-unblock');
    expect(writes()[1]).toEqual([{ method: 'DELETE', path: '/api/v1/users/ABCD2345/block' }]);
    expect(has('person-profile-send')).toBe(true);
    expect(has('person-profile-block')).toBe(true);
  });

  it('while the server has not answered, 차단 cannot start', async () => {
    mockApi.mockImplementation(() => new Promise(() => undefined));
    const { renderer } = await mount();
    const button = renderer.root.findAll(node => node.props.testID === 'person-profile-block' && typeof node.props.onPress === 'function')[0];
    expect(button.props.disabled).toBe(true);
  });
});
