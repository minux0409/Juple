import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput, View } from 'react-native';
import i18n from '../../i18n';
import { NewLinkReviewScreen } from '../NewLinkReviewScreen';
import { addItemToCollection, createCollection, getCollections } from '../../collections/api/collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { updateItemDetails } from '../../items/api/itemsApi';
import { resolveUrlMetadata } from '../../urlMetadata/api/urlMetadataApi';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  getCollections: jest.fn(),
  addItemToCollection: jest.fn(),
  createCollection: jest.fn(),
}));

jest.mock('../../inbox/api/inboxApi', () => ({
  saveInboxEntry: jest.fn(),
}));

jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
}));

jest.mock('../../urlMetadata/api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
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
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null });
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

  it('never calls resolveUrlMetadata when an incoming title is already present', async () => {
    await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).not.toHaveBeenCalled();
  });

  it('fetches URL metadata and fills the empty title field when there is no incoming title', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: 'Metadata Title', source: 'openGraph' });

    const { renderer } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveUrlMetadata).toHaveBeenCalledWith(expect.anything(), 'https://example.com/shared');
    const [, titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('Metadata Title');
  });

  it('does not overwrite a title the user already started typing once URL metadata resolves', async () => {
    let resolveMetadata!: (value: { title: string | null; source: string | null }) => void;
    jest.mocked(resolveUrlMetadata).mockReturnValue(
      new Promise(resolve => {
        resolveMetadata = resolve;
      }),
    );

    const { renderer } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
    });

    const [, titleInput] = renderer.root.findAllByType(TextInput);
    await act(async () => {
      titleInput.props.onChangeText('User typed title');
    });

    await act(async () => {
      resolveMetadata({ title: 'Metadata Title', source: 'openGraph' });
      await Promise.resolve();
      await Promise.resolve();
    });

    const [, titleInputAfter] = renderer.root.findAllByType(TextInput);
    expect(titleInputAfter.props.value).toBe('User typed title');
  });

  it('metadata resolution failure leaves the title blank and Save still works', async () => {
    jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 70,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });

    const { renderer, navigation } = await renderScreen({ initialTitle: null });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const [, titleInput] = renderer.root.findAllByType(TextInput);
    expect(titleInput.props.value).toBe('');

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(saveInboxEntry).toHaveBeenCalled();
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

  it('lays out categories as wrapping chips, not a horizontal scroller', async () => {
    jest.mocked(getCollections).mockResolvedValue({
      items: [{ id: 3, name: '영화', isFavorite: false, itemCount: 0, createdAtUtc: '', updatedAtUtc: '' }],
      nextCursor: null,
    });
    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    const wrappingRow = renderer.root.findAllByType(View).find(node => {
      const style = node.props.style;
      const flattened = Array.isArray(style) ? Object.assign({}, ...style) : style;
      return flattened?.flexWrap === 'wrap';
    });
    expect(wrappingRow).toBeTruthy();
  });

  it('creating a new category adds it to the list and auto-selects it', async () => {
    jest.mocked(createCollection).mockResolvedValue({
      id: 9,
      name: '캠핑',
      isFavorite: false,
      itemCount: 0,
      createdAtUtc: '',
      updatedAtUtc: '',
    });
    jest.mocked(saveInboxEntry).mockResolvedValue({
      id: 60,
      url: 'https://example.com/shared',
      savedAtUtc: '2026-01-01T00:00:00Z',
    });
    jest.mocked(addItemToCollection).mockResolvedValue(undefined);

    const { renderer } = await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      const addNewButton = renderer.root.findAll(
        node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(t => t.props.children === i18n.t('collections.addNew')),
      )[0];
      addNewButton.props.onPress();
    });

    const nameInput = renderer.root.findAllByType(TextInput).find(input => input.props.placeholder === i18n.t('collections.namePlaceholder'))!;
    await act(async () => {
      nameInput.props.onChangeText('캠핑');
    });

    await act(async () => {
      const createButton = renderer.root.findAll(
        node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(t => t.props.children === i18n.t('collections.create')),
      )[0];
      await createButton.props.onPress();
    });

    expect(createCollection).toHaveBeenCalledWith(expect.anything(), '캠핑');
    expect(findByAccessibilityLabel(renderer, '캠핑')).toBeTruthy();

    await act(async () => {
      pressSaveButton(renderer);
    });

    expect(addItemToCollection).toHaveBeenCalledWith(expect.anything(), 9, 60);
  });
});
