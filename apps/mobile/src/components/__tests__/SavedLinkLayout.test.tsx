import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, View } from 'react-native';
import { ItemAdderBadge } from '../ItemAdderBadge';
import { SavedLinkGridCard, savedLinkGridLayout } from '../SavedLinkGridCard';
import { SavedLinkRow } from '../SavedLinkRow';
import { GRID_CARD_PADDING_H, GRID_CELL_PADDING_H, LINK_CONTROLS_TOP_GAP, savedLinkLayout, SAVED_LINK_CARD_GAP } from '../savedLinkLayout';
import { fitInlineReactionKinds, ReactionChips } from '../../reactions/ReactionChips';
import type { ItemAdderDisplay } from '../../collections/itemAdder';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';

const item: ItemHistoryEntry = {
  id: 1, url: 'https://example.com', title: '링크', memo: null, savedAtUtc: new Date().toISOString(),
  representativeImage: null, previewImageUrl: null, coverImage: null,
};
const adder: ItemAdderDisplay = {
  kind: 'person', jupleId: 'K7MP4Q8N', displayName: '피카츄', imageUrl: null, imageVersion: null, isCollectionOwner: false, isMe: false, accessibilityLabel: '피카츄님이 추가한 링크',
};
const chips = <ReactionChips inline onAdd={jest.fn()} onToggle={jest.fn()} reactions={{ reactions: [{ key: 'heart', count: 2 }], myReaction: null }} testID="chips" />;

const create = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

describe('reactions sit on the author row', () => {
  it.each([
    ['List row', <SavedLinkRow addedBy={adder} isActionInFlight={false} item={item} reactions={chips} />],
    ['Grid tile', <SavedLinkGridCard addedBy={adder} isActionInFlight={false} item={item} reactions={chips} />],
  ])('%s: the chips and the adder avatar share one horizontal row - no row of their own', (_name, element) => {
    const renderer = create(element);

    const badge = renderer.root.findByType(ItemAdderBadge);
    const line = badge.parent!;
    expect(StyleSheet.flatten(line.props.style)).toMatchObject({ flexDirection: 'row' });
    expect(line.findAll(node => node.props.testID === 'chips' && typeof node.type === 'string')).toHaveLength(1);
    // The trailing slot takes the remaining width (and can shrink) rather than overflowing a 320dp card.
    const trailing = line.findAll(node => node.props.style != null && node.props.testID === undefined && StyleSheet.flatten(node.props.style)?.flex === 1)[0];
    expect(StyleSheet.flatten(trailing.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(trailing.findAll(node => node.props.testID === 'chips').length).toBeGreaterThan(0);
    // The chips never wrap and add no top margin (inline).
    const chipRow = renderer.root.findAll(node => node.props.testID === 'chips' && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(chipRow.props.style)).toMatchObject({ flexWrap: 'nowrap', marginTop: 0, justifyContent: 'flex-end', alignSelf: 'stretch' });
  });

  it('without an adder there is no row to share: the chips go under the time line, as before', () => {
    const renderer = create(<SavedLinkRow isActionInFlight={false} item={item} reactions={<ReactionChips onAdd={jest.fn()} onToggle={jest.fn()} reactions={{ reactions: [{ key: 'heart', count: 1 }], myReaction: null }} testID="chips" />} />);

    expect(renderer.root.findAllByType(ItemAdderBadge)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'chips' && typeof node.type === 'string')).toHaveLength(1);
  });
});

describe('shared link layout tokens', () => {
  it('Grid has as much air at the sides as above and below, from one rule for Home, 보관함 and a Collection', () => {
    // Tile content sits 8 in from its frame on all four sides; neighbouring tiles are 8 apart (4 per cell).
    expect(GRID_CARD_PADDING_H).toBe(8);
    expect(StyleSheet.flatten(savedLinkGridLayout.cell)).toMatchObject({ paddingHorizontal: GRID_CELL_PADDING_H, marginBottom: 8 });
    expect(GRID_CELL_PADDING_H * 2).toBe(8);
    const renderer = create(<SavedLinkGridCard isActionInFlight={false} item={item} />);
    const card = renderer.root.findAllByType(View)[0];
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ paddingHorizontal: GRID_CARD_PADDING_H, paddingVertical: 8 });
    expect(LINK_CONTROLS_TOP_GAP).toBeGreaterThan(8);
  });

  it('a standalone card (Home, a Collection by name) gaps below, never above, so the first card gets no extra top gap', () => {
    const card = StyleSheet.flatten(savedLinkLayout.card) as Record<string, unknown>;
    expect(card.marginBottom).toBe(SAVED_LINK_CARD_GAP);
    expect(card.marginTop).toBeUndefined();
  });

  it('every Grid frame (Home, History, a Collection) is the same 50% cell with the same bordered tile', () => {
    expect(StyleSheet.flatten(savedLinkGridLayout.cell)).toMatchObject({ flexBasis: '50%', maxWidth: '50%' });
    expect(StyleSheet.flatten(savedLinkGridLayout.swipeContainer)?.borderWidth).toBe(StyleSheet.hairlineWidth);
  });

  it('keeps one View per row body: padding lives in SavedLinkRow only', () => {
    const renderer = create(<SavedLinkRow isActionInFlight={false} item={item} />);
    const rowView = renderer.root.findAllByType(View)[0];
    expect(StyleSheet.flatten(rowView.props.style)).toMatchObject({ paddingHorizontal: 12, paddingVertical: 12 });
  });
});

describe('inline reactions never wrap', () => {
  const many = { reactions: [{ key: 'heart', count: 5 }, { key: 'thumbsUp', count: 3 }, { key: 'laugh', count: 2 }, { key: 'wow', count: 1 }], myReaction: null };
  const chipsAt = (width: number) => {
    const renderer = create(<ReactionChips inline onAdd={jest.fn()} onToggle={jest.fn()} reactions={many} testID="chips" />);
    act(() => {
      renderer.root.findAll(node => node.props.testID === 'chips' && typeof node.type === 'string')[0].props.onLayout({ nativeEvent: { layout: { width, height: 24, x: 0, y: 0 } } });
    });
    const kinds = renderer.root.findAll(node => /^chips-(heart|thumbsUp|laugh|wow)$/.test(String(node.props.testID)) && typeof node.props.onPress === 'function');
    const more = renderer.root.findAll(node => node.props.testID === 'chips-more' && typeof node.type === 'string');
    const add = renderer.root.findAll(node => node.props.testID === 'chips-add' && typeof node.props.onPress === 'function');
    return { renderer, kinds, more, add };
  };

  it('is a single non-wrapping row and keeps the add affordance', () => {
    const { renderer, add } = chipsAt(200);
    const row = renderer.root.findAll(node => node.props.testID === 'chips' && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexWrap: 'nowrap', flexDirection: 'row' });
    expect(add).toHaveLength(1);
  });

  it.each([[96], [120], [166], [260]])('at %sdp available it collapses what does not fit into +N instead of wrapping', width => {
    const { kinds, more } = chipsAt(width);
    expect(kinds.length).toBeGreaterThanOrEqual(1);
    expect(kinds.length + (more.length ? 1 : 0)).toBeLessThanOrEqual(4);
    // 4 kinds exist: whatever is not shown as a chip is counted in +N - reactions are never hidden.
    expect(more.length).toBe(kinds.length < 4 ? 1 : 0);
    const needed = kinds.length * 48 + (more.length ? 32 : 0) + 28;
    if (kinds.length > 1) {
      expect(needed).toBeLessThanOrEqual(width);
    }
  });

  it('fits more kinds as the width grows, and always at least one', () => {
    expect(fitInlineReactionKinds(null, 4, 3)).toBe(1);
    expect(fitInlineReactionKinds(90, 4, 3)).toBe(1);
    expect(fitInlineReactionKinds(160, 4, 3)).toBe(2);
    expect(fitInlineReactionKinds(400, 4, 3)).toBe(3);
    expect(fitInlineReactionKinds(400, 2, 3)).toBe(2);
  });

  it('the author area can shrink while the avatar keeps its size', () => {
    const renderer = create(<SavedLinkRow addedBy={{ kind: 'publicLink', label: '아주 아주 긴 공개 링크 추가자 표시 문구입니다', accessibilityLabel: 'x' }} isActionInFlight={false} item={item} reactions={chips} />);
    const badge = renderer.root.findByType(ItemAdderBadge);
    expect(StyleSheet.flatten(badge.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
    const text = badge.findAll(node => node.props.numberOfLines === 1)[0];
    expect(text).toBeTruthy();
  });
});
