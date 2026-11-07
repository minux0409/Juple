import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';
import { SelectionOverlay } from '../../selection/SelectionOverlay';
import { SavedLinkImageRow, SavedLinkImageTile } from '../SavedLinkImageTile';
import { SwipeableItemRow } from '../SwipeableItemRow';

function makeItem(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return {
    id: 1,
    url: 'https://example.com/path',
    title: 'Saved title',
    memo: null,
    savedAtUtc: new Date().toISOString(),
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

describe('SwipeableItemRow in selection mode', () => {
  it('without selection it is the plain swipeable row - no checkbox layer', () => {
    const renderer = render(<SwipeableItemRow onPress={jest.fn()}><Text>card</Text></SwipeableItemRow>);
    expect(renderer.root.findAllByProps({ testID: 'swipeable-row-select' })).toHaveLength(0);
  });

  it('with selection a checkbox layer takes the card: it shows the state and a tap only toggles', () => {
    const onPress = jest.fn();
    const onToggle = jest.fn();
    const renderer = render(
      <SwipeableItemRow onPress={onPress} selection={{ selected: false, onToggle }}><Text>card</Text></SwipeableItemRow>,
    );
    const layer = renderer.root.findAllByProps({ testID: 'swipeable-row-select' }).filter(node => typeof node.props.onPress === 'function')[0];
    expect(layer.props.accessibilityRole).toBe('checkbox');
    expect(layer.props.accessibilityState).toEqual({ checked: false });
    act(() => layer.props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a chosen card says so to assistive technology too', () => {
    const renderer = render(
      <SwipeableItemRow onPress={jest.fn()} selection={{ selected: true, onToggle: jest.fn() }}><Text>card</Text></SwipeableItemRow>,
    );
    const layer = renderer.root.findAllByProps({ testID: 'swipeable-row-select' }).filter(node => typeof node.props.onPress === 'function')[0];
    expect(layer.props.accessibilityState).toEqual({ checked: true });
  });
});

describe('Image tile in selection mode', () => {
  it('a tap chooses the tile and never opens it; the long-press is not wired', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const onToggleSelect = jest.fn();
    const item = makeItem();
    const renderer = render(<SavedLinkImageTile item={item} onLongPress={onLongPress} onPress={onPress} onToggleSelect={onToggleSelect} selected={false} selecting />);
    const tile = renderer.root.findAllByProps({ testID: 'saved-link-image-tile-select' }).filter(node => typeof node.props.onPress === 'function')[0];
    expect(tile.props.accessibilityRole).toBe('checkbox');
    expect(tile.props.onLongPress).toBeUndefined();
    act(() => tile.props.onPress());
    expect(onToggleSelect).toHaveBeenCalledWith(item);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('a locked (redacted) tile can still be seen as chosen without showing anything of the link', () => {
    const item = makeItem({ isCollectionLocked: true, url: '', title: null });
    const renderer = render(<SavedLinkImageTile item={item} onPress={jest.fn()} onToggleSelect={jest.fn()} selected selecting />);
    const tile = renderer.root.findAllByProps({ testID: 'saved-link-image-tile-select' }).filter(node => typeof node.props.onPress === 'function')[0];
    expect(tile.props.accessibilityState).toEqual({ checked: true });
  });

  it('the row hands each tile its own chosen state', () => {
    const items = [makeItem({ id: 1 }), makeItem({ id: 2, title: 'Two' })];
    const renderer = render(
      <SavedLinkImageRow
        items={items}
        onPress={jest.fn()}
        selection={{ isActive: true, selectedIds: new Set([2]), onToggle: jest.fn() }}
      />,
    );
    const tiles = renderer.root.findAllByProps({ testID: 'saved-link-image-tile-select' }).filter(node => typeof node.props.onPress === 'function');
    expect(tiles.map(tile => tile.props.accessibilityState.checked)).toEqual([false, true]);
  });
});

describe('SelectionOverlay', () => {
  it('is a full-card checkbox: it reports the state and toggles without touching the card under it', () => {
    const onToggle = jest.fn();
    const renderer = render(<SelectionOverlay accessibilityLabel="Card" onToggle={onToggle} selected />);
    const layer = renderer.root.findAllByProps({ testID: 'selection-overlay' }).filter(node => typeof node.props.onPress === 'function')[0];
    expect(layer.props.accessibilityRole).toBe('checkbox');
    expect(layer.props.accessibilityState).toEqual({ checked: true });
    act(() => layer.props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
