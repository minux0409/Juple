import { NavigationContainer } from '@react-navigation/native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../../i18n';
import { MainTabs } from '../MainTabs';
import { AttentionContext } from '../../attention/attentionContext';
import { createMobileAttentionStore } from '../../attention/mobileAttention';

jest.mock('../../screens/DailyInboxScreen', () => ({ DailyInboxScreen: () => null }));
jest.mock('../../screens/DateHistoryScreen', () => ({ DateHistoryScreen: () => null }));
jest.mock('../../screens/CollectionsScreen', () => ({ CollectionsScreen: () => null }));
jest.mock('../../screens/MyPageScreen', () => ({ MyPageScreen: () => null }));

it('renders account-scoped 99+ and incoming badges, hides zero, and clears them on account replacement', async () => {
  const store = createMobileAttentionStore(jest.fn());
  store.replace('invitations', Array.from({ length: 101 }, (_, index) => ({ invitationId: index + 1, collectionId: index + 1, collectionName: 'Collection', icon: 'Folder', color: null, ownerJupleId: 'OWNER', role: 'viewer', createdAtUtc: '', expiresAtUtc: '' })));
  store.replace('friends', [{ requestId: 1, direction: 'incoming', jupleId: 'PERSON', displayName: null, createdAtUtc: '' }]);
  const initialMetrics = { frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 34 } };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<AttentionContext.Provider value={store}><SafeAreaProvider initialMetrics={initialMetrics}><NavigationContainer><MainTabs /></NavigationContainer></SafeAreaProvider></AttentionContext.Provider>);
  });
  expect(renderer.root.findAll(node => node.props.children === '99+').length).toBeGreaterThan(0);
  expect(renderer.root.findAll(node => node.props.children === '1').length).toBeGreaterThan(0);
  expect(renderer.root.findAll(node => node.props.children === '0')).toHaveLength(0);
  await act(async () => { store.reset(); });
  expect(renderer.root.findAll(node => node.props.children === '99+')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.children === '1')).toHaveLength(0);
  await act(async () => renderer.unmount());
});
