import ReactTestRenderer, { act } from 'react-test-renderer';
import { BlockedUsersScreen } from '../BlockedUsersScreen';

const mockRequest = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const person = {
  jupleId: 'ABC12345',
  displayName: 'Mina',
  blockedAtUtc: '2026-10-30T00:00:00Z',
  hiddenCollections: [{ id: 7, name: 'Trip' }],
};

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<BlockedUsersScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

describe('BlockedUsersScreen', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockNavigate.mockReset();
  });

  it('a hidden Collection stays reachable: its row opens the normal Collection screen', async () => {
    mockRequest.mockResolvedValue({ body: { items: [person] } });
    const renderer = await renderScreen();
    await act(async () => byId(renderer, 'blocked-user-collection-7').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('CollectionDetails', { collectionId: 7 });
  });

  it('unblocking asks first, then calls the server and removes the row', async () => {
    mockRequest.mockResolvedValue({ body: { items: [person] } });
    const renderer = await renderScreen();
    await act(async () => byId(renderer, 'blocked-user-unblock-ABC12345').props.onPress());
    expect(mockRequest).toHaveBeenCalledTimes(1);

    const dialog = renderer.root.findAll(node => node.props.visible === true && typeof node.props.onConfirm === 'function')[0];
    mockRequest.mockResolvedValue({ body: undefined });
    await act(async () => dialog.props.onConfirm());
    expect(mockRequest).toHaveBeenLastCalledWith({ method: 'DELETE', path: '/api/v1/users/ABC12345/block' });
    expect(renderer.root.findAll(node => node.props.testID === 'blocked-user-ABC12345')).toHaveLength(0);
  });

  it('an empty list says so', async () => {
    mockRequest.mockResolvedValue({ body: { items: [] } });
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => node.props.testID === 'blocked-users-empty').length).toBeGreaterThan(0);
  });
});
