import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { ViewModeToggle } from '../ViewModeToggle';

function render(props: Partial<React.ComponentProps<typeof ViewModeToggle>> = {}) {
  const onChange = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<ViewModeToggle onChange={onChange} value="list" {...props} />);
  });
  return { renderer, onChange };
}
const option = (renderer: ReactTestRenderer.ReactTestRenderer, label: string) =>
  renderer.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

describe('ViewModeToggle', () => {
  it('stays List / Grid everywhere that does not opt in', () => {
    const { renderer } = render();
    expect(option(renderer, 'List view')).toBeDefined();
    expect(option(renderer, 'Grid view')).toBeDefined();
    expect(option(renderer, 'Image view')).toBeUndefined();
  });

  it('adds Image only when asked, selecting and reporting it like the others', () => {
    const { renderer, onChange } = render({ showImage: true, value: 'image' });
    expect(option(renderer, 'Image view').props.accessibilityState).toEqual({ selected: true });
    expect(option(renderer, 'List view').props.accessibilityState).toEqual({ selected: false });
    expect(option(renderer, 'Grid view').props.accessibilityState).toEqual({ selected: false });

    act(() => option(renderer, 'Grid view').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('grid');
    act(() => option(renderer, 'Image view').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('image');
  });

  it('with three options each keeps a 44dp touch target', () => {
    const { renderer } = render({ showImage: true });
    for (const label of ['List view', 'Grid view', 'Image view']) {
      const button = option(renderer, label);
      const style = StyleSheet.flatten(button.props.style);
      expect(style.width).toBeGreaterThanOrEqual(44);
      expect(style.height + button.props.hitSlop.top + button.props.hitSlop.bottom).toBeGreaterThanOrEqual(44);
    }
  });

  describe('icons', () => {
    const glyph = (renderer: ReactTestRenderer.ReactTestRenderer, label: string, testID: string) =>
      option(renderer, label).findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];

    it('List is three lines and Grid four blocks, as before', () => {
      const { renderer } = render({ showImage: true });
      expect(glyph(renderer, 'List view', 'view-mode-list-glyph').children).toHaveLength(3);
      expect(glyph(renderer, 'Grid view', 'view-mode-grid-glyph').children).toHaveLength(4);
    });

    it('Image is exactly nine small blocks in a 3x3, about 20dp overall, centered in its button', () => {
      const { renderer } = render({ showImage: true });
      const glyphNode = glyph(renderer, 'Image view', 'view-mode-image-glyph');
      expect(renderer.root.findAll(node => node.props.testID === 'view-mode-image-glyph' && typeof node.type === 'string')).toHaveLength(1);
      const blocks = glyphNode.children as ReactTestRenderer.ReactTestInstance[];
      expect(blocks).toHaveLength(9);
      const box = StyleSheet.flatten(glyphNode.props.style);
      const cell = StyleSheet.flatten(blocks[0].props.style);
      expect(blocks.every(block => StyleSheet.flatten(block.props.style).width === cell.width && StyleSheet.flatten(block.props.style).height === cell.height)).toBe(true);
      // 3 columns x 3 rows: three blocks and two gaps span the whole width (so a fourth cannot fit on a line), likewise down.
      expect(box).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
      const span = 3 * cell.width + 2 * box.gap;
      expect(span).toBeCloseTo(box.width, 5);
      expect(span).toBeCloseTo(box.height, 5);
      expect(4 * cell.width + 3 * box.gap).toBeGreaterThan(box.width);
      expect(box.width).toBeGreaterThanOrEqual(19);
      expect(box.width).toBeLessThanOrEqual(21);
      expect(cell.borderRadius).toBeGreaterThan(0);
      expect(StyleSheet.flatten(option(renderer, 'Image view').props.style)).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
    });

    it('is visibly denser than Grid: smaller blocks and a tighter gap', () => {
      const { renderer } = render({ showImage: true });
      const imageBlock = StyleSheet.flatten((glyph(renderer, 'Image view', 'view-mode-image-glyph').children[0] as ReactTestRenderer.ReactTestInstance).props.style);
      const gridBlock = StyleSheet.flatten((glyph(renderer, 'Grid view', 'view-mode-grid-glyph').children[0] as ReactTestRenderer.ReactTestInstance).props.style);
      expect(imageBlock.width).toBeLessThanOrEqual(gridBlock.width);
      expect(StyleSheet.flatten(glyph(renderer, 'Image view', 'view-mode-image-glyph').props.style).gap).toBeLessThan(StyleSheet.flatten(glyph(renderer, 'Grid view', 'view-mode-grid-glyph').props.style).gap);
      expect(glyph(renderer, 'Image view', 'view-mode-image-glyph').children.length).toBeGreaterThan(glyph(renderer, 'Grid view', 'view-mode-grid-glyph').children.length);
    });

    it('uses the same selected / unselected colors as List and Grid', () => {
      const unselected = render({ showImage: true, value: 'list' }).renderer;
      const selected = render({ showImage: true, value: 'image' }).renderer;
      const color = (renderer: ReactTestRenderer.ReactTestRenderer, label: string, testID: string, _inner: boolean) =>
        StyleSheet.flatten((glyph(renderer, label, testID).children[0] as ReactTestRenderer.ReactTestInstance).props.style).backgroundColor;
      expect(color(unselected, 'Image view', 'view-mode-image-glyph', false)).toBe(color(unselected, 'Grid view', 'view-mode-grid-glyph', true));
      // Selected is the brand color, unselected the neutral one - the same pair List and Grid switch between.
      const selectedList = render({ showImage: true, value: 'list' }).renderer;
      expect(color(selected, 'Image view', 'view-mode-image-glyph', false)).toBe(color(selectedList, 'List view', 'view-mode-list-glyph', true));
      expect(color(selected, 'Image view', 'view-mode-image-glyph', false)).not.toBe(color(unselected, 'Image view', 'view-mode-image-glyph', false));
    });
  });
});
