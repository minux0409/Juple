import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import i18n from '../../i18n';
import { NewLinkReviewScreen } from '../NewLinkReviewScreen';
import { addItemToCollection, getCollections } from '../../collections/api/collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { updateItemDetails } from '../../items/api/itemsApi';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
}));

const ROUTE_PARAMS: { url: string; initialTitle: string | null; preselectedCollectionId: number | null } = {
  url: 'https://example.com/shared',
  initialTitle: 'Shared title',
  preselectedCollectionId: null,
};

function makeProps(routeParamOverrides: Partial<typeof ROUTE_PARAMS> = {}) {
  return {
    route: { params: { ...ROUTE_PARAMS, ...routeParamOverrides }, key: 'r', name: 'NewLinkReview' as const },
    navigation: { goBack: jest.fn() },
  } as any;
}

async function renderScreen(routeParamOverrides: Partial<typeof ROUTE_PARAMS> = {}) {
  const props = makeProps(routeParamOverrides);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<NewLinkReviewScreen {...props} />);
  });
  return { renderer, navigation: props.navigation };
}

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

/** The Save button doesn't set accessibilityLabel, so it's found by its label Text, walking up to the nearest onPress-bearing ancestor. */
function pressSaveButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  let node: ReactTestRenderer.ReactTestInstance | null = renderer.root.findAll(
    n => n.props.children === i18n.t('common.save'),
  )[0];
  while (node && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  node!.props.onPress();
}

describe('NewLinkReviewScreen', () => {
  beforeEach(() => {
    jest.mocked(getCollections).mockResolvedValue({ items: [], nextCursor: null });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('prefills the url and title from route params', async () => {
    const { renderer } = await renderScreen();

    const [urlInput, titleInput] = renderer.root.findAllByType(TextInput);
    expect(urlInput.props.value).toBe('https://example.com/shared');
    expect(titleInput.props.value).toBe('Shared title');
  });

  it('never calls any Item API before Save is tapped', async () => {
    await renderScreen();

    expect(saveInboxEntry).not.toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
  });

  it('saves the url/title/memo and links the selected category, in order, then goes back', async () => {
    jest.mocked(getCollections).mockResolvedValue({
      items: [{ id: 3, name: '영화', isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '' }],
      nextCursor: null,
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 55,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    jest.mocked(addItemToCollection).mockResolvedValue(undefined);

    const { renderer, navigation } = await renderScreen();
    // Flush the initial getCollections load.
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      findByAccessibilityLabel(renderer, '영화').props.onPress();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalledWith(expect.anything(), 'https://example.com/shared');
    expect(updateItemDetails).toHaveBeenCalledWith(expect.anything(), 55, { title: 'Shared title', memo: '' });
    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 3, 55);
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('skips updateItemDetails and addItemToCollection when title/memo are empty and no category is selected', async () => {
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 56,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });

    const { renderer, navigation } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalled();
    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(addItemToCollection).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not navigate back when saving fails', async () => {
    jest.mocked(saveInboxEntry).mockRejectedValue(new Error('network down'));

    const { renderer, navigation } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ children: i18n.t('inbox.errorSaveFallback') })).toBeTruthy();
  });
});
