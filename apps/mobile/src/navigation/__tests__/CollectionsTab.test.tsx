import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import { MainTabs, type MainTabParamList } from '../MainTabs';

// The screens themselves have their own tests; here only where a Collection opens matters.
jest.mock('../../screens/DailyInboxScreen', () => ({ DailyInboxScreen: () => null }));
jest.mock('../../screens/DateHistoryScreen', () => ({ DateHistoryScreen: () => null }));
jest.mock('../../screens/MyPageScreen', () => ({ MyPageScreen: () => null }));
jest.mock('../../screens/CollectionsScreen', () => ({ CollectionsScreen: () => require('react').createElement(require('react-native').Text, null, 'collections-list') }));
jest.mock('../../screens/CollectionDetailsScreen', () => ({
  CollectionDetailsScreen: ({ route }: { route: { params: { collectionId: number } } }) =>
    require('react').createElement(require('react-native').Text, null, `collection-${route.params.collectionId}`),
}));

const metrics = { frame: { x: 0, y: 0, width: 360, height: 720 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function renderTabs() {
  const ref = createNavigationContainerRef<MainTabParamList>();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer ref={ref}><MainTabs /></NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  return { renderer, ref };
}

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);
/** The tab buttons the tab bar draws (one per tab, found as in MainTabs.test), each with its selection. */
const tabButtons = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props['aria-selected'] !== undefined && typeof node.props.onPress === 'function' && node.props.tourId === undefined);
const selectedTabLabel = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  tabButtons(renderer).find(node => node.props['aria-selected'] === true)?.props['aria-label'] as string | undefined;

describe('a Collection opens inside the 컬렉션 tab', () => {
  it('keeps the tab bar under it with 컬렉션 selected, and back returns to the Collections list', async () => {
    const { renderer, ref } = await renderTabs();
    await act(async () => {
      ref.navigate('Collections', { screen: 'CollectionDetails', params: { collectionId: 7 }, initial: false });
    });

    expect(texts(renderer)).toContain('collection-7');
    expect(new Set(tabButtons(renderer).map(node => node.props['aria-label'])).size).toBe(4);
    expect(selectedTabLabel(renderer)).toContain(i18n.t('tabs.collections'));

    // The Collections list is under it (also when the tab had not been visited yet): back lands there, still in the tab.
    await act(async () => { ref.goBack(); });
    expect(texts(renderer)).toContain('collections-list');
    expect(selectedTabLabel(renderer)).toContain(i18n.t('tabs.collections'));
  });

  it('switching to another tab and back keeps the open Collection (each tab keeps its own place)', async () => {
    const { renderer, ref } = await renderTabs();
    await act(async () => {
      ref.navigate('Collections', { screen: 'CollectionDetails', params: { collectionId: 9 }, initial: false });
    });
    await act(async () => { ref.navigate('Home'); });
    expect(selectedTabLabel(renderer)).toContain(i18n.t('tabs.home'));
    await act(async () => { ref.navigate('Collections'); });
    expect(selectedTabLabel(renderer)).toContain(i18n.t('tabs.collections'));
    const collections = ref.getRootState()?.routes.find(route => route.name === 'Collections')?.state;
    expect(collections?.routes.map(route => route.name)).toEqual(['CollectionsHome', 'CollectionDetails']);
    expect(collections?.index).toBe(1);
  });

  it('tapping 컬렉션 again while a Collection is open goes back to the list (the stack\'s tab-press behavior)', async () => {
    const { renderer, ref } = await renderTabs();
    await act(async () => {
      ref.navigate('Collections', { screen: 'CollectionDetails', params: { collectionId: 9 }, initial: false });
    });
    const collectionsTab = tabButtons(renderer).find(node => node.props['aria-selected'] === true)!;
    await act(async () => { collectionsTab.props.onPress(); });
    // The stack pops on the next frame (after every tabPress listener has had its say).
    await act(async () => { await new Promise<void>(resolve => { setTimeout(() => resolve(), 50); }); });
    const collections = ref.getRootState()?.routes.find(route => route.name === 'Collections')?.state;
    expect(collections?.routes.map(route => route.name)).toEqual(['CollectionsHome']);
    expect(texts(renderer)).toContain('collections-list');
  });
});
