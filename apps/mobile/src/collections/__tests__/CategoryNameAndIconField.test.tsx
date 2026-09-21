import ReactTestRenderer, { act } from 'react-test-renderer';
import '../../i18n';
import { CategoryNameAndIconField } from '../CategoryNameAndIconField';
import { resolveCollectionColorTile } from '../collectionColors';
import { FolderIcon } from '../../icons/FolderIcon';
import { PlaneIcon } from '../../icons/PlaneIcon';

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

function expandPanel(renderer: ReactTestRenderer.ReactTestRenderer) {
  act(() => {
    renderer.root.findByProps({ testID: 'category-icon-thumbnail-button' }).props.onPress();
  });
}

describe('CategoryNameAndIconField', () => {
  it('does not show the icon grid or color swatches until the thumbnail is tapped', () => {
    const renderer = render(
      <CategoryNameAndIconField
        color="Blue"
        icon="Folder"
        name=""
        onChangeColor={jest.fn()}
        onChangeIcon={jest.fn()}
        onChangeName={jest.fn()}
      />,
    );

    expect(renderer.root.findAllByProps({ testID: 'collection-icon-option-Heart' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'collection-color-option-Mint' })).toHaveLength(0);
  });

  it('expands both the icon grid and the color swatch row together on tap', () => {
    const renderer = render(
      <CategoryNameAndIconField
        color="Blue"
        icon="Folder"
        name=""
        onChangeColor={jest.fn()}
        onChangeIcon={jest.fn()}
        onChangeName={jest.fn()}
      />,
    );

    expandPanel(renderer);

    expect(renderer.root.findAllByProps({ testID: 'collection-icon-option-Heart' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByProps({ testID: 'collection-color-option-Mint' }).length).toBeGreaterThan(0);
  });

  it('renders every unselected icon grid cell in the same currently-selected color, not a per-index palette', () => {
    const expectedTile = resolveCollectionColorTile('Mint');
    // icon="Heart" (not Folder) so the Folder cell below is an unselected grid cell, distinct from
    // the selected cell's own separate "highlighted in brand blue" convention (CollectionIconPicker).
    const renderer = render(
      <CategoryNameAndIconField
        color="Mint"
        icon="Heart"
        name=""
        onChangeColor={jest.fn()}
        onChangeIcon={jest.fn()}
        onChangeName={jest.fn()}
      />,
    );

    expandPanel(renderer);

    // Two unrelated, unselected icons - previously each would have picked its own color from a
    // per-index palette slice; now both must share the one currently-selected color.
    expect(renderer.root.findByType(FolderIcon).props.color).toBe(expectedTile.icon);
    expect(renderer.root.findByType(PlaneIcon).props.color).toBe(expectedTile.icon);
  });

  it('picking a color calls onChangeColor and updates the thumbnail without collapsing the panel', () => {
    const onChangeColor = jest.fn();
    const renderer = render(
      <CategoryNameAndIconField
        color="Blue"
        icon="Folder"
        name=""
        onChangeColor={onChangeColor}
        onChangeIcon={jest.fn()}
        onChangeName={jest.fn()}
      />,
    );

    expandPanel(renderer);
    act(() => {
      renderer.root.findByProps({ testID: 'collection-color-option-Mint' }).props.onPress();
    });

    expect(onChangeColor).toHaveBeenCalledWith('Mint');
    // Panel stays open - both pickers must still be present after selecting a color.
    expect(renderer.root.findAllByProps({ testID: 'collection-icon-option-Heart' }).length).toBeGreaterThan(0);
  });

  it('picking an icon calls onChangeIcon without collapsing the panel', () => {
    const onChangeIcon = jest.fn();
    const renderer = render(
      <CategoryNameAndIconField
        color="Blue"
        icon="Folder"
        name=""
        onChangeColor={jest.fn()}
        onChangeIcon={onChangeIcon}
        onChangeName={jest.fn()}
      />,
    );

    expandPanel(renderer);
    act(() => {
      renderer.root.findByProps({ testID: 'collection-icon-option-Heart' }).props.onPress();
    });

    expect(onChangeIcon).toHaveBeenCalledWith('Heart');
    expect(renderer.root.findAllByProps({ testID: 'collection-color-option-Mint' }).length).toBeGreaterThan(0);
  });
});
