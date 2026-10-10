import ReactTestRenderer, { act } from 'react-test-renderer';
import { Dimensions, Image, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { LinkIcon } from '../../icons/LinkIcon';
import { LockIcon } from '../../icons/LockIcon';
import { SiteIcon } from '../../icons/SiteIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';
import {
  chunkIntoImageLines,
  SAVED_LINK_IMAGE_COLUMNS,
  SAVED_LINK_IMAGE_GUTTER,
  SavedLinkImageRow,
  SavedLinkImageRowSkeleton,
  SavedLinkImageTile,
} from '../SavedLinkImageTile';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function makeItem(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return {
    id: 1,
    url: 'https://example.com/path',
    title: 'Saved title',
    memo: 'A private memo',
    savedAtUtc: new Date().toISOString(),
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

function renderTile(item: ItemHistoryEntry, onPress = jest.fn()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<SavedLinkImageTile item={item} onPress={onPress} />);
  });
  return { renderer, onPress };
}
const allText = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const pressable = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.find(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button');

describe('SavedLinkImageTile', () => {
  it('is only the picture: cover-cropped, a square, no text of any kind (no title, time, host, memo or site name)', () => {
    const { renderer } = renderTile(makeItem({ previewImageUrl: 'https://img.example/p.jpg' }));

    const picture = renderer.root.findByType(Image);
    expect(picture.props.source).toEqual({ uri: 'https://img.example/p.jpg' });
    expect(picture.props.resizeMode).toBe('cover');
    expect(StyleSheet.flatten(picture.props.style)).toMatchObject({ height: '100%', width: '100%' });
    expect(StyleSheet.flatten(pressable(renderer).props.style)).toMatchObject({ aspectRatio: 1, flex: 1 });
    expect(allText(renderer)).toEqual([]);
  });

  it('uses the same picture priority as every card: cover, then first photo, then link preview', () => {
    const photo = (readUrl: string) => ({ readUrl } as never);
    const urlOf = (item: ItemHistoryEntry) => renderTile(item).renderer.root.findByType(Image).props.source.uri;
    expect(urlOf(makeItem({ coverImage: photo('cover'), representativeImage: photo('first'), previewImageUrl: 'preview' }))).toBe('cover');
    expect(urlOf(makeItem({ representativeImage: photo('first'), previewImageUrl: 'preview' }))).toBe('first');
    expect(urlOf(makeItem({ previewImageUrl: 'preview' }))).toBe('preview');
  });

  it('labels itself for screen readers with the saved title, else the same safe fallback a card uses', () => {
    expect(pressable(renderTile(makeItem()).renderer).props.accessibilityLabel).toBe('Saved title');
    expect(pressable(renderTile(makeItem({ title: null })).renderer).props.accessibilityLabel).toBe('example.com');
  });

  it('without a picture: a known site shows its own large icon, and no text', () => {
    const { renderer } = renderTile(makeItem({ url: 'https://www.youtube.com/watch?v=abc' }));
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findByType(SiteIcon).props).toMatchObject({ siteId: 'youtube', size: 48 });
    expect(allText(renderer)).toEqual([]);
  });

  it('without a picture and no known site: a plain link glyph, never the hostname', () => {
    const { renderer } = renderTile(makeItem());
    expect(renderer.root.findAllByType(SiteIcon)).toHaveLength(0);
    expect(renderer.root.findAllByType(LinkIcon)).toHaveLength(1);
    expect(allText(renderer)).toEqual([]);
  });

  it('falls back the same way when the picture fails to load, and tries a new URL again', () => {
    const { renderer } = renderTile(makeItem({ previewImageUrl: 'https://img.example/broken.jpg' }));
    act(() => {
      renderer.root.findByType(Image).props.onError();
    });
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findAllByType(LinkIcon)).toHaveLength(1);

    act(() => {
      renderer.update(<SavedLinkImageTile item={makeItem({ previewImageUrl: 'https://img.example/fresh.jpg' })} onPress={jest.fn()} />);
    });
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'https://img.example/fresh.jpg' });
  });

  it('a locked link is a lock on a neutral square - nothing of the hidden link, in text, picture, site icon or label', () => {
    const { renderer } = renderTile(makeItem({
      isCollectionLocked: true,
      title: 'Secret title',
      url: 'https://www.youtube.com/watch?v=secret',
      memo: 'secret memo',
      previewImageUrl: 'https://img.example/secret.jpg',
      coverImage: { readUrl: 'https://img.example/secret-cover.jpg' } as never,
    }));

    expect(renderer.root.findAllByType(LockIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findAllByType(SiteIcon)).toHaveLength(0);
    expect(allText(renderer)).toEqual([]);
    const button = pressable(renderer);
    expect(button.props.accessibilityLabel).toBe(i18n.t('item.lockedLinkPlaceholder'));
    expect(JSON.stringify(renderer.toJSON())).not.toMatch(/secret|youtube/i);
  });

  it('presses through the given open callback with its item - locked or not', () => {
    const plain = makeItem({ id: 5 });
    const first = renderTile(plain);
    act(() => pressable(first.renderer).props.onPress());
    expect(first.onPress).toHaveBeenCalledWith(plain);

    const locked = makeItem({ id: 6, isCollectionLocked: true });
    const second = renderTile(locked);
    act(() => pressable(second.renderer).props.onPress());
    expect(second.onPress).toHaveBeenCalledWith(locked);
  });
});

describe('SavedLinkImageRow', () => {
  const render = (items: ItemHistoryEntry[]) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SavedLinkImageRow items={items} onPress={jest.fn()} testID="row" />);
    });
    return renderer;
  };
  const items = (count: number) => Array.from({ length: count }, (_, index) => makeItem({ id: index + 1 }));

  it('is three square slots with a small gutter, and a short last line keeps the same tile size', () => {
    expect(SAVED_LINK_IMAGE_COLUMNS).toBe(3);
    expect(SAVED_LINK_IMAGE_GUTTER).toBeGreaterThanOrEqual(2);
    expect(SAVED_LINK_IMAGE_GUTTER).toBeLessThanOrEqual(4);
    const full = render(items(3));
    const row = full.root.find(node => node.props.testID === 'row' && typeof node.type === 'string');
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', columnGap: SAVED_LINK_IMAGE_GUTTER, marginBottom: SAVED_LINK_IMAGE_GUTTER });
    const tiles = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'saved-link-image-tile' && typeof node.type === 'string');
    expect(tiles(full)).toHaveLength(3);

    // One link: still three slots in the line, so the one tile is the same width as in a full line.
    const partial = render(items(1));
    expect(tiles(partial)).toHaveLength(1);
    expect(partial.root.find(node => node.props.testID === 'row' && typeof node.type === 'string').children).toHaveLength(3);
  });

  it.each([
    ['phone portrait', 411, 891, 3],
    ['phone landscape', 891, 411, 3],
    ['7in tablet portrait', 600, 960, 5],
    ['10in tablet portrait', 800, 1280, 6],
    ['10in tablet landscape', 1280, 800, 8],
  ])('%s (%p x %p dp): a line holds %p equal slots (a short last line keeps the tile size)', (_name, width, height, columns) => {
    act(() => { Dimensions.set({ window: { ...Dimensions.get('window'), width, height } }); });
    try {
      const renderer = render(items(1));
      expect(renderer.root.find(node => node.props.testID === 'row' && typeof node.type === 'string').children).toHaveLength(columns);
      act(() => renderer.unmount());
    } finally {
      act(() => { Dimensions.set({ window: { ...Dimensions.get('window'), width: 411, height: 1334 } }); });
    }
  });

  it('skeleton: three plain squares, no text', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SavedLinkImageRowSkeleton testID="sk" />);
    });
    const line = renderer.root.find(node => node.props.testID === 'sk' && typeof node.type === 'string');
    expect(line.children).toHaveLength(3);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
  });
});

describe('chunkIntoImageLines', () => {
  it('lines of three in order, the last one short', () => {
    expect(chunkIntoImageLines([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkIntoImageLines([])).toEqual([]);
  });
});
