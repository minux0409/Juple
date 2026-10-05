import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { usePersonProfile, type PersonProfileTarget } from '../PersonProfileModal';
import { getFriendRequests, getFriends, sendFriendRequest, type Friend, type FriendRequest } from '../api/friendsApi';

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../api/friendsApi', () => ({
  ...jest.requireActual('../api/friendsApi'),
  getFriends: jest.fn(),
  getFriendRequests: jest.fn(),
  sendFriendRequest: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => jest.clearAllMocks());

const friend = (jupleId: string): Friend => ({ friendshipId: 3, jupleId, displayName: '꼬부기', myNote: null, friendsSinceUtc: '' });
const request = (jupleId: string, direction: 'incoming' | 'outgoing'): FriendRequest => ({ requestId: 1, jupleId, direction } as FriendRequest);

let open!: (person: PersonProfileTarget) => void;
function Harness() {
  const { openProfile, profileModal } = usePersonProfile();
  open = openProfile;
  return profileModal;
}

async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<Harness />);
  });
  const has = (testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
  return { renderer, has };
}

const person = (jupleId: string, extra: Partial<PersonProfileTarget> = {}): PersonProfileTarget => ({ jupleId, displayName: '꼬부기', ...extra });

describe('usePersonProfile - the relationship is resolved BEFORE exactly one modal opens', () => {
  beforeEach(() => {
    jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(getFriendRequests).mockResolvedValue([]);
  });

  it('a friend: nothing at all while resolving, then the friend detail directly - the user-info modal is never rendered', async () => {
    let resolveFriends!: (value: { items: Friend[]; nextCursor: null }) => void;
    jest.mocked(getFriends).mockReturnValue(new Promise(resolve => {
      resolveFriends = resolve;
    }));
    const { has } = await mount();
    const seen: string[] = [];
    const record = () => ['person-profile', 'friend-detail'].forEach(id => has(id) && seen.push(id));

    await act(async () => {
      open(person('CNTRC234'));
    });
    record();
    expect(seen).toEqual([]);
    await act(async () => {
      resolveFriends({ items: [friend('CNTRC234')], nextCursor: null });
    });
    record();
    expect(seen).toEqual(['friend-detail']);
    expect(has('person-profile')).toBe(false);
  });

  it('a non-friend: the profile opens directly with the request button; sending it switches to "request sent" (no duplicate offered)', async () => {
    jest.mocked(sendFriendRequest).mockResolvedValue({ requestId: 2 } as never);
    const { renderer, has } = await mount();
    await act(async () => {
      open(person('CNTRC234'));
    });
    expect(has('person-profile')).toBe(true);
    expect(has('friend-detail')).toBe(false);

    await act(async () => {
      renderer.root.findAll(node => node.props.testID === 'person-profile-send' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(sendFriendRequest).toHaveBeenCalledTimes(1);
    expect(has('person-profile-send')).toBe(false);
    expect(has('person-profile-status-pending')).toBe(true);
  });

  it('a request I already sent: the profile shows "request sent" from the start, never a second request button', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([request('CNTRC234', 'outgoing')]);
    const { has } = await mount();
    await act(async () => {
      open(person('CNTRC234'));
    });
    expect(has('person-profile-status-pending')).toBe(true);
    expect(has('person-profile-send')).toBe(false);
  });

  it('someone who already asked me: that is said, with no request button', async () => {
    jest.mocked(getFriendRequests).mockResolvedValue([request('CNTRC234', 'incoming')]);
    const { has } = await mount();
    await act(async () => {
      open(person('CNTRC234'));
    });
    expect(has('person-profile-status-incoming')).toBe(true);
    expect(has('person-profile-send')).toBe(false);
  });

  it('myself: my own identity at once - no lookup, no request button', async () => {
    const { has } = await mount();
    await act(async () => {
      open(person('MEEE2345', { isSelf: true }));
    });
    expect(has('person-profile-status-self')).toBe(true);
    expect(has('person-profile-send')).toBe(false);
    expect(getFriends).not.toHaveBeenCalled();
    expect(getFriendRequests).not.toHaveBeenCalled();
  });

  describe('every tap asks the server for the CURRENT relationship (nothing is remembered between taps)', () => {
    const close = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
      await act(async () => {
        renderer.root.findAll(node => typeof node.props.onClose === 'function' && ['person-profile', 'friend-detail'].includes(node.props.testID))[0].props.onClose();
      });
    };

    it('REGRESSION: I send a request, they accept it on another device, my next tap opens the friend detail - not the old pending state, not the profile first', async () => {
      jest.mocked(sendFriendRequest).mockResolvedValue({ requestId: 2 } as never);
      const { renderer, has } = await mount();

      // First tap: not friends, nothing pending -> the profile with the request button; sending it shows pending.
      await act(async () => {
        open(person('CNTRC234'));
      });
      await act(async () => {
        renderer.root.findAll(node => node.props.testID === 'person-profile-send' && typeof node.props.onPress === 'function')[0].props.onPress();
      });
      expect(has('person-profile-status-pending')).toBe(true);
      await close(renderer);

      // Remote acceptance: the server now says friends (and the request is gone).
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('CNTRC234')], nextCursor: null });
      jest.mocked(getFriendRequests).mockResolvedValue([]);
      const seen: string[] = [];
      await act(async () => {
        open(person('CNTRC234'));
      });
      ['person-profile', 'friend-detail'].forEach(id => has(id) && seen.push(id));

      expect(seen).toEqual(['friend-detail']);
      expect(has('person-profile-status-pending')).toBe(false);
      expect(getFriends).toHaveBeenCalledTimes(2);
      expect(getFriendRequests).toHaveBeenCalledTimes(2);
    });

    it('a request that is still pending on the server stays pending on the next tap', async () => {
      jest.mocked(getFriendRequests).mockResolvedValue([request('CNTRC234', 'outgoing')]);
      const { renderer, has } = await mount();
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-status-pending')).toBe(true);
      await close(renderer);
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-status-pending')).toBe(true);
      expect(has('person-profile-send')).toBe(false);
    });

    it('a non-friend who became a friend between taps opens the friend detail; a friendship removed elsewhere opens the profile with the request button again', async () => {
      const { renderer, has } = await mount();
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-send')).toBe(true);
      await close(renderer);

      jest.mocked(getFriends).mockResolvedValue({ items: [friend('CNTRC234')], nextCursor: null });
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('friend-detail')).toBe(true);
      expect(has('person-profile')).toBe(false);
      await close(renderer);

      jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-send')).toBe(true);
      expect(has('friend-detail')).toBe(false);
    });

    it('an incoming request that was answered or withdrawn elsewhere is not shown from an old result', async () => {
      jest.mocked(getFriendRequests).mockResolvedValue([request('CNTRC234', 'incoming')]);
      const { renderer, has } = await mount();
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-status-incoming')).toBe(true);
      await close(renderer);

      jest.mocked(getFriendRequests).mockResolvedValue([]);
      await act(async () => {
        open(person('CNTRC234'));
      });
      expect(has('person-profile-status-incoming')).toBe(false);
      expect(has('person-profile-send')).toBe(true);
    });

    it('taps landing while a lookup is in flight are the same tap: one pair of requests, one modal', async () => {
      let resolveFriends!: (value: { items: Friend[]; nextCursor: null }) => void;
      jest.mocked(getFriends).mockReturnValue(new Promise(resolve => {
        resolveFriends = resolve;
      }));
      const { has } = await mount();
      await act(async () => {
        open(person('CNTRC234'));
        open(person('CNTRC234'));
        open(person('OTHR2345'));
      });
      await act(async () => {
        resolveFriends({ items: [], nextCursor: null });
      });

      expect(getFriends).toHaveBeenCalledTimes(1);
      expect(getFriendRequests).toHaveBeenCalledTimes(1);
      expect(has('person-profile')).toBe(true);
    });
  });

  it('a lookup that fails opens the profile in its error state with a retry (and still no friend-request button)', async () => {
    jest.mocked(getFriends).mockRejectedValueOnce(new Error('offline'));
    const { has } = await mount();
    await act(async () => {
      open(person('CNTRC234'));
    });
    expect(has('person-profile-error')).toBe(true);
    expect(has('person-profile-send')).toBe(false);
    expect(has('person-profile-error-retry')).toBe(true);
  });
});
