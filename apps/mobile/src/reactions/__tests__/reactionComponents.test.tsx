import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { QuickReactionBar } from '../QuickReactionBar';
import { ReactionChips } from '../ReactionChips';
import { ReactionPickerDialog } from '../ReactionPickerDialog';
import { REACTION_CATALOG } from '../reactionCatalog';
import { SmileyPlusIcon } from '../../icons/SmileyPlusIcon';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const pressableById = (renderer: Renderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const create = (element: React.ReactElement): Renderer => {
  let renderer!: Renderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

describe('QuickReactionBar', () => {
  it('shows ❤️ 👍 ✅ 😂 😮 😢 and + in that order, each a 44dp target', () => {
    const renderer = create(<QuickReactionBar myReaction={null} onMore={jest.fn()} onSelect={jest.fn()} />);

    const ids = renderer.root
      .findAll(node => typeof node.props.testID === 'string' && /^quick-reaction-/.test(node.props.testID) && typeof node.props.onPress === 'function')
      .map(node => node.props.testID);
    expect([...new Set(ids)]).toEqual(['quick-reaction-heart', 'quick-reaction-thumbsUp', 'quick-reaction-check', 'quick-reaction-laugh', 'quick-reaction-wow', 'quick-reaction-sad', 'quick-reaction-more']);
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['❤️', '👍', '✅', '😂', '😮', '😢']);
    expect(StyleSheet.flatten(pressableById(renderer, 'quick-reaction-heart').props.style).height).toBeGreaterThanOrEqual(44);
    expect(StyleSheet.flatten(pressableById(renderer, 'quick-reaction-more').props.style).height).toBeGreaterThanOrEqual(44);
  });

  it('marks the caller\'s own reaction as selected - softly, never with a loud fill', () => {
    const renderer = create(<QuickReactionBar myReaction="laugh" onMore={jest.fn()} onSelect={jest.fn()} />);

    const mine = pressableById(renderer, 'quick-reaction-laugh');
    expect(mine.props.accessibilityState).toEqual({ selected: true });
    expect(mine.props.accessibilityLabel).toBe('내가 선택한 😂 반응');
    expect(pressableById(renderer, 'quick-reaction-heart').props.accessibilityState).toEqual({ selected: false });
    expect(pressableById(renderer, 'quick-reaction-heart').props.accessibilityLabel).toBe('😂'.length > 0 ? '❤️ 반응' : '');
    const style = StyleSheet.flatten(mine.props.style);
    expect(style.backgroundColor).toBe('#E9F0FE');
  });

  it('tapping a reaction selects it, + opens the picker; "+" says what it is for a screen reader', () => {
    const onSelect = jest.fn();
    const onMore = jest.fn();
    const renderer = create(<QuickReactionBar myReaction={null} onMore={onMore} onSelect={onSelect} />);

    act(() => pressableById(renderer, 'quick-reaction-wow').props.onPress());
    act(() => pressableById(renderer, 'quick-reaction-more').props.onPress());

    expect(onSelect).toHaveBeenCalledWith('wow');
    expect(onMore).toHaveBeenCalledTimes(1);
    expect(pressableById(renderer, 'quick-reaction-more').props.accessibilityLabel).toBe('다른 리액션 선택');
  });
});

describe('ReactionChips', () => {
  it('draws nothing at all when nobody reacted - a clean card - unless the add affordance is asked for', () => {
    const empty = create(<ReactionChips onAdd={jest.fn()} onToggle={jest.fn()} reactions={{ reactions: [], myReaction: null }} />);
    expect(empty.toJSON()).toBeNull();

    const detail = create(<ReactionChips alwaysShowAdd onAdd={jest.fn()} onToggle={jest.fn()} reactions={{ reactions: [], myReaction: null }} />);
    expect(detail.root.findAllByType(SmileyPlusIcon)).toHaveLength(1);
  });

  it('chips with counts - most used first - then the add affordance; my own chip is selected', () => {
    const renderer = create(
      <ReactionChips
        onAdd={jest.fn()}
        onToggle={jest.fn()}
        reactions={{ reactions: [{ key: 'laugh', count: 2 }, { key: 'heart', count: 3 }, { key: 'thumbsUp', count: 1 }], myReaction: 'thumbsUp' }}
      />,
    );

    const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(texts).toEqual(['❤️', 3, '😂', 2, '👍', 1]);
    expect(pressableById(renderer, 'reaction-chips-thumbsUp').props.accessibilityState).toEqual({ selected: true });
    expect(pressableById(renderer, 'reaction-chips-heart').props.accessibilityState).toEqual({ selected: false });
    expect(pressableById(renderer, 'reaction-chips-heart').props.accessibilityLabel).toBe('❤️ 반응 3개');
    expect(renderer.root.findAllByType(SmileyPlusIcon)).toHaveLength(1);
  });

  it('draws at most three kinds and says how many more with +N', () => {
    const renderer = create(
      <ReactionChips
        onAdd={jest.fn()}
        onToggle={jest.fn()}
        reactions={{ reactions: ['heart', 'thumbsUp', 'check', 'laugh', 'wow'].map((key, index) => ({ key, count: 9 - index })), myReaction: null }}
      />,
    );

    const kinds = renderer.root.findAll(node => typeof node.props.testID === 'string' && /^reaction-chips-(heart|thumbsUp|check|laugh|wow)$/.test(node.props.testID) && typeof node.props.onPress === 'function');
    expect(kinds).toHaveLength(3);
    const more = renderer.root.findAll(node => node.props.testID === 'reaction-chips-more' && String(node.type) === 'View')[0];
    expect(more.props.accessibilityLabel).toBe('다른 반응 2종류');
    expect(renderer.root.findAllByType(Text).some(node => [node.props.children].flat().join('') === '+2')).toBe(true);
  });

  it('a chip toggles that reaction, the smiley-plus opens the picker', () => {
    const onToggle = jest.fn();
    const onAdd = jest.fn();
    const renderer = create(<ReactionChips onAdd={onAdd} onToggle={onToggle} reactions={{ reactions: [{ key: 'heart', count: 1 }], myReaction: null }} />);

    act(() => pressableById(renderer, 'reaction-chips-heart').props.onPress());
    act(() => pressableById(renderer, 'reaction-chips-add').props.onPress());

    expect(onToggle).toHaveBeenCalledWith('heart');
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('wraps on a narrow screen instead of clipping, and every chip reaches a 44dp target through hitSlop', () => {
    const renderer = create(
      <ReactionChips
        onAdd={jest.fn()}
        onToggle={jest.fn()}
        reactions={{ reactions: [{ key: 'heart', count: 128 }, { key: 'thumbsUp', count: 64 }, { key: 'check', count: 32 }, { key: 'laugh', count: 1 }], myReaction: null }}
      />,
    );

    const row = renderer.root.findAll(node => node.props.testID === 'reaction-chips' && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(row.props.style).flexWrap).toBe('wrap');
    const chip = pressableById(renderer, 'reaction-chips-heart');
    const style = StyleSheet.flatten(chip.props.style);
    expect(style.height + chip.props.hitSlop.top + chip.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
    // No fixed widths that could clip a long count on a 320dp screen.
    expect(style.width).toBeUndefined();
  });
});

describe('ReactionPickerDialog', () => {
  const picker = (props: Partial<React.ComponentProps<typeof ReactionPickerDialog>> = {}) =>
    create(<ReactionPickerDialog myReaction={null} onClose={jest.fn()} onSelect={jest.fn()} recent={[]} visible {...props} />);

  it('appears at once - no slide-up animation', () => {
    const modal = picker().root.findByType(Modal);

    expect(modal.props.animationType).toBe('none');
    expect(modal.props.visible).toBe(true);
  });

  it('shows the whole catalog as a grid under 기본, with the title and a close button', () => {
    const renderer = picker();

    for (const reaction of REACTION_CATALOG) {
      expect(pressableById(renderer, `reaction-option-${reaction.key}`)).toBeDefined();
    }
    const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(texts).toContain('리액션 추가');
    expect(texts).toContain('기본');
    expect(pressableById(renderer, 'reaction-picker-close')).toBeDefined();
    expect(pressableById(renderer, 'reaction-picker-close').props.accessibilityLabel).toBe('닫기');
  });

  it('hides 최근 사용 when there is none, and shows it (in the given order) when there is', () => {
    expect(picker().root.findAll(node => node.props.testID === 'reaction-picker-recent-section')).toHaveLength(0);

    const renderer = picker({ recent: ['fire', 'heart', 'laugh'] });
    expect(renderer.root.findAll(node => node.props.testID === 'reaction-picker-recent-section').length).toBeGreaterThan(0);
    const recentIds = renderer.root
      .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('reaction-recent-') && typeof node.props.onPress === 'function')
      .map(node => node.props.testID);
    expect([...new Set(recentIds)]).toEqual(['reaction-recent-fire', 'reaction-recent-heart', 'reaction-recent-laugh']);
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toContain('최근 사용');
  });

  it('choosing a reaction reports it; the current one is marked as mine', () => {
    const onSelect = jest.fn();
    const renderer = picker({ onSelect, myReaction: 'fire' });

    act(() => pressableById(renderer, 'reaction-option-eyes').props.onPress());

    expect(onSelect).toHaveBeenCalledWith('eyes');
    expect(pressableById(renderer, 'reaction-option-fire').props.accessibilityState).toEqual({ selected: true });
    expect(pressableById(renderer, 'reaction-option-fire').props.accessibilityLabel).toBe('내가 선택한 🔥 반응');
  });

  it('is not rendered visible when closed', () => {
    expect(picker({ visible: false }).root.findByType(Modal).props.visible).toBe(false);
  });
});
