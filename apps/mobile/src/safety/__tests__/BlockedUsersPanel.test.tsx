import ReactTestRenderer, { act } from 'react-test-renderer';
import { BlockedUsersPanel } from '../BlockedUsersPanel';
import { openedCollections } from '../../testing/collectionNavigationDriver';
import { StyleSheet } from 'react-native';
import { UserAvatar } from '../../components/UserAvatar';
import { colors, getActiveColorScheme, minTouchTarget, radii, setActiveColorScheme, spacing } from '../../theme/tokens';

const mockRequest = jest.fn();
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate, dispatch: mockDispatch }),
    CommonActions: jest.requireActual('@react-navigation/native').CommonActions,
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
    renderer = ReactTestRenderer.create(<BlockedUsersPanel />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

describe('BlockedUsersPanel', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockNavigate.mockReset();
    mockDispatch.mockReset();
  });

  it('a hidden Collection stays reachable: its row opens the normal Collection screen', async () => {
    mockRequest.mockResolvedValue({ body: { items: [person] } });
    const renderer = await renderScreen();
    await act(async () => byId(renderer, 'blocked-user-collection-7').props.onPress());
    // In the 컬렉션 tab (see navigation/collectionNavigation).
    expect(openedCollections(mockDispatch)).toEqual([{ collectionId: 7 }]);
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

  it.each(['light', 'dark'] as const)('%s: blocked people use a borderless rounded friend card without losing their unblock target', async scheme => {
    const previous = getActiveColorScheme();
    setActiveColorScheme(scheme);
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    try {
      mockRequest.mockResolvedValue({ body: { items: [person] } });
      renderer = await renderScreen();
      const card = renderer.root.findAll(node => node.props.testID === 'blocked-user-ABC12345' && typeof node.type === 'string')[0];
      const style = StyleSheet.flatten(card.props.style);
      expect(style).toMatchObject({ backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md });
      expect(style.borderWidth ?? 0).toBe(0);
      expect(renderer.root.findByType(UserAvatar).props.size).toBe(44);
      const action = byId(renderer, 'blocked-user-unblock-ABC12345');
      expect(StyleSheet.flatten(action.props.style).minHeight).toBeGreaterThanOrEqual(minTouchTarget);
      expect(mockRequest).toHaveBeenCalledTimes(1); // rendering never unblocks anyone
    } finally {
      act(() => renderer?.unmount());
      setActiveColorScheme(previous);
    }
  });
});
