import i18n from '../../i18n';
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
    expect(option(renderer, i18n.t('common.viewList'))).toBeDefined();
    expect(option(renderer, i18n.t('common.viewGrid'))).toBeDefined();
    expect(option(renderer, i18n.t('common.viewImage'))).toBeUndefined();
  });

  it('adds Image only when asked, selecting and reporting it like the others', () => {
    const { renderer, onChange } = render({ showImage: true, value: 'image' });
    expect(option(renderer, i18n.t('common.viewImage')).props.accessibilityState).toEqual({ selected: true });
    expect(option(renderer, i18n.t('common.viewList')).props.accessibilityState).toEqual({ selected: false });
    expect(option(renderer, i18n.t('common.viewGrid')).props.accessibilityState).toEqual({ selected: false });

    act(() => option(renderer, i18n.t('common.viewGrid')).props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('grid');
    act(() => option(renderer, i18n.t('common.viewImage')).props.onPress());
    expect(onChange).toHaveBeenLastCalledWith('image');
  });

  it('with three options each keeps a 44dp touch target', () => {
    const { renderer } = render({ showImage: true });
    for (const label of [i18n.t('common.viewList'), i18n.t('common.viewGrid'), i18n.t('common.viewImage')]) {
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
      expect(glyph(renderer, i18n.t('common.viewList'), 'view-mode-list-glyph').children).toHaveLength(3);
      expect(glyph(renderer, i18n.t('common.viewGrid'), 'view-mode-grid-glyph').children).toHaveLength(4);
    });

    it('Image is exactly nine small blocks in a 3x3, about 20dp overall, centered in its button', () => {
      const { renderer } = render({ showImage: true });
      const glyphNode = glyph(renderer, i18n.t('common.viewImage'), 'view-mode-image-glyph');
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
      expect(StyleSheet.flatten(option(renderer, i18n.t('common.viewImage')).props.style)).toMatchObject({ alignItems: 'center', justifyContent: 'center' });
    });

    it('is visibly denser than Grid: smaller blocks and a tighter gap', () => {
      const { renderer } = render({ showImage: true });
      const imageBlock = StyleSheet.flatten((glyph(renderer, i18n.t('common.viewImage'), 'view-mode-image-glyph').children[0] as ReactTestRenderer.ReactTestInstance).props.style);
      const gridBlock = StyleSheet.flatten((glyph(renderer, i18n.t('common.viewGrid'), 'view-mode-grid-glyph').children[0] as ReactTestRenderer.ReactTestInstance).props.style);
      expect(imageBlock.width).toBeLessThanOrEqual(gridBlock.width);
      expect(StyleSheet.flatten(glyph(renderer, i18n.t('common.viewImage'), 'view-mode-image-glyph').props.style).gap).toBeLessThan(StyleSheet.flatten(glyph(renderer, i18n.t('common.viewGrid'), 'view-mode-grid-glyph').props.style).gap);
      expect(glyph(renderer, i18n.t('common.viewImage'), 'view-mode-image-glyph').children.length).toBeGreaterThan(glyph(renderer, i18n.t('common.viewGrid'), 'view-mode-grid-glyph').children.length);
    });

    it('uses the same selected / unselected colors as List and Grid', () => {
      const unselected = render({ showImage: true, value: 'list' }).renderer;
      const selected = render({ showImage: true, value: 'image' }).renderer;
      const color = (renderer: ReactTestRenderer.ReactTestRenderer, label: string, testID: string, _inner: boolean) =>
        StyleSheet.flatten((glyph(renderer, label, testID).children[0] as ReactTestRenderer.ReactTestInstance).props.style).backgroundColor;
      expect(color(unselected, i18n.t('common.viewImage'), 'view-mode-image-glyph', false)).toBe(color(unselected, i18n.t('common.viewGrid'), 'view-mode-grid-glyph', true));
      // Selected is the brand color, unselected the neutral one - the same pair List and Grid switch between.
      const selectedList = render({ showImage: true, value: 'list' }).renderer;
      expect(color(selected, i18n.t('common.viewImage'), 'view-mode-image-glyph', false)).toBe(color(selectedList, i18n.t('common.viewList'), 'view-mode-list-glyph', true));
      expect(color(selected, i18n.t('common.viewImage'), 'view-mode-image-glyph', false)).not.toBe(color(unselected, i18n.t('common.viewImage'), 'view-mode-image-glyph', false));
    });
  });
});

describe('ViewModeToggle - accessibility labels follow the app language', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each([
    ['ko', ['목록 보기', '그리드 보기', '이미지 보기', '촘촘한 그리드 보기']],
    ['ja', ['リスト表示', 'グリッド表示', '画像表示', 'コンパクトグリッド表示']],
    ['de', ['Listenansicht', 'Rasteransicht', 'Bildansicht', 'Kompakte Rasteransicht']],
  ])('%s', async (language, labels) => {
    await i18n.changeLanguage(language);
    const { renderer } = render({ showImage: true, showCompact: true });
    for (const label of labels) {
      expect(option(renderer, label)).toBeDefined();
    }
    expect(option(renderer, 'List view')).toBeUndefined();
  });

  it('every language defines all four labels, and only English reads English', () => {
    const fsx = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string): string[] }>('fs');
    const pathx = jest.requireActual<{ join(...parts: string[]): string }>('path');
    const dir = pathx.join(__dirname, '../../i18n/locales');
    const en = JSON.parse(fsx.readFileSync(pathx.join(dir, 'en.json'), 'utf8')).common;
    for (const file of fsx.readdirSync(dir)) {
      const common = JSON.parse(fsx.readFileSync(pathx.join(dir, file), 'utf8')).common;
      for (const key of ['viewList', 'viewGrid', 'viewImage', 'viewCompact']) {
        expect(common[key]?.trim().length).toBeGreaterThan(0);
        if (file !== 'en.json') {
          expect(common[key]).not.toBe(en[key]);
        }
      }
    }
  });

  it('the component hard-codes no English label any more', () => {
    const fsx = jest.requireActual<{ readFileSync(file: string, encoding: string): string }>('fs');
    const pathx = jest.requireActual<{ join(...parts: string[]): string }>('path');
    expect(fsx.readFileSync(pathx.join(__dirname, '../ViewModeToggle.tsx'), 'utf8')).not.toMatch(/'(List|Grid|Image|Compact grid) view'/);
  });
});
