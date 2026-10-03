import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { LinkSortChips } from '../LinkSortChips';
import { isNameSort, nextDateSort, nextNameSort, type LinkSortOption } from '../../settings/sortPreference';

function render(sort: LinkSortOption, handlers: { onPressDate?: () => void; onPressName?: () => void } = {}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <LinkSortChips
        dateLabel="Time"
        dateNewestA11yLabel="Time, newest first"
        dateOldestA11yLabel="Time, oldest first"
        nameAscA11yLabel="Name, A to Z"
        nameDescA11yLabel="Name, Z to A"
        nameLabel="Name"
        onPressDate={handlers.onPressDate ?? jest.fn()}
        onPressName={handlers.onPressName ?? jest.fn()}
        sort={sort}
        testIDPrefix="t"
      />,
    );
  });
  return renderer;
}
const chip = (renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') =>
  renderer.root.find(node => node.props.testID === `t-${which}` && typeof node.props.onPress === 'function');
const label = (renderer: ReactTestRenderer.ReactTestRenderer, which: 'date' | 'name') => chip(renderer, which).findByType(Text).props.children;

describe('LinkSortChips - Time and Name, each in both directions', () => {
  it.each([
    ['newest', 'Time ↓', 'Time, newest first', 'Name'],
    ['oldest', 'Time ↑', 'Time, oldest first', 'Name'],
  ] as const)('%s: the Time chip shows its direction (and says it), Name is plain', (sort, dateLabel, dateA11y, nameLabel) => {
    const renderer = render(sort);

    expect(label(renderer, 'date')).toBe(dateLabel);
    expect(chip(renderer, 'date').props.accessibilityLabel).toBe(dateA11y);
    expect(chip(renderer, 'date').props.accessibilityState).toEqual({ selected: true });
    expect(label(renderer, 'name')).toBe(nameLabel);
    expect(chip(renderer, 'name').props.accessibilityState).toEqual({ selected: false });
  });

  it.each([
    ['title', 'Name ↑', 'Name, A to Z'],
    ['titleDesc', 'Name ↓', 'Name, Z to A'],
  ] as const)('%s: the Name chip shows its direction and states it in words for assistive technology, Time is plain', (sort, nameLabel, nameA11y) => {
    const renderer = render(sort);

    expect(label(renderer, 'name')).toBe(nameLabel);
    expect(chip(renderer, 'name').props.accessibilityLabel).toBe(nameA11y);
    expect(chip(renderer, 'name').props.accessibilityState).toEqual({ selected: true });
    expect(label(renderer, 'date')).toBe('Time');
    expect(chip(renderer, 'date').props.accessibilityState).toEqual({ selected: false });
  });

  it('pressing calls the handlers (the screens own what happens)', () => {
    const onPressDate = jest.fn();
    const onPressName = jest.fn();
    const renderer = render('newest', { onPressDate, onPressName });

    act(() => chip(renderer, 'date').props.onPress());
    act(() => chip(renderer, 'name').props.onPress());
    expect(onPressDate).toHaveBeenCalledTimes(1);
    expect(onPressName).toHaveBeenCalledTimes(1);
  });
});

describe('sort-state model (one for every screen)', () => {
  it('Time: first press picks newest ↓ (from anywhere), then flips ↓ ↔ ↑', () => {
    expect(nextDateSort('title')).toBe('newest');
    expect(nextDateSort('titleDesc')).toBe('newest');
    expect(nextDateSort('newest')).toBe('oldest');
    expect(nextDateSort('oldest')).toBe('newest');
  });

  it('Name: first press picks A→Z ↑ (from anywhere), then flips ↑ ↔ ↓', () => {
    expect(nextNameSort('newest')).toBe('title');
    expect(nextNameSort('oldest')).toBe('title');
    expect(nextNameSort('title')).toBe('titleDesc');
    expect(nextNameSort('titleDesc')).toBe('title');
  });

  it('isNameSort', () => {
    expect(['title', 'titleDesc'].every(sort => isNameSort(sort as LinkSortOption))).toBe(true);
    expect(['newest', 'oldest'].some(sort => isNameSort(sort as LinkSortOption))).toBe(false);
  });
});
