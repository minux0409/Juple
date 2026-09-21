import ReactTestRenderer, { act } from 'react-test-renderer';
import { CategoryIconTile } from '../CategoryIconTile';
import { resolveCollectionColorTile } from '../collectionColors';
import { FolderIcon } from '../../icons/FolderIcon';
import { HeartIcon } from '../../icons/HeartIcon';
import { PlaneIcon } from '../../icons/PlaneIcon';
import { categoryTilePalette } from '../../theme/tokens';

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

describe('CategoryIconTile', () => {
  it('renders the Heart icon for icon="Heart"', () => {
    const renderer = render(<CategoryIconTile collectionId={1} icon="Heart" />);
    expect(renderer.root.findAllByType(HeartIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(0);
  });

  it('renders the Plane icon for icon="Plane"', () => {
    const renderer = render(<CategoryIconTile collectionId={1} icon="Plane" />);
    expect(renderer.root.findAllByType(PlaneIcon)).toHaveLength(1);
  });

  it('renders the Folder icon for icon="Folder"', () => {
    const renderer = render(<CategoryIconTile collectionId={1} icon="Folder" />);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(1);
  });

  it('falls back to Folder for an unrecognized/legacy icon value', () => {
    const renderer = render(<CategoryIconTile collectionId={1} icon="SomeFutureIcon" />);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(1);
  });

  it('uses the same palette tile background for the same collectionId regardless of icon', () => {
    const expectedTile = categoryTilePalette[42 % categoryTilePalette.length];

    const heart = render(<CategoryIconTile collectionId={42} icon="Heart" />);
    const folder = render(<CategoryIconTile collectionId={42} icon="Folder" />);

    expect(heart.root.findByType(HeartIcon).props.color).toBe(expectedTile.icon);
    expect(folder.root.findByType(FolderIcon).props.color).toBe(expectedTile.icon);
  });

  it('uses a different palette tile for a different collectionId', () => {
    const tileA = categoryTilePalette[1 % categoryTilePalette.length];
    const tileB = categoryTilePalette[2 % categoryTilePalette.length];
    // Only meaningful when the palette actually differs between these two ids.
    expect(tileA).not.toEqual(tileB);

    const rendererA = render(<CategoryIconTile collectionId={1} icon="Folder" />);
    const rendererB = render(<CategoryIconTile collectionId={2} icon="Folder" />);

    expect(rendererA.root.findByType(FolderIcon).props.color).toBe(tileA.icon);
    expect(rendererB.root.findByType(FolderIcon).props.color).toBe(tileB.icon);
  });

  it('uses the explicit color when one is provided, overriding the id-deterministic fallback', () => {
    const expectedTile = resolveCollectionColorTile('Mint');
    // A collectionId whose own deterministic fallback color is deliberately NOT Mint, so this only
    // passes if the explicit color actually took priority.
    const fallbackTile = categoryTilePalette[1 % categoryTilePalette.length];
    expect(expectedTile.icon).not.toBe(fallbackTile.icon);

    const renderer = render(<CategoryIconTile collectionId={1} color="Mint" icon="Folder" />);

    expect(renderer.root.findByType(FolderIcon).props.color).toBe(expectedTile.icon);
  });

  it('falls back to the id-deterministic palette when color is null (a legacy/unset row)', () => {
    const fallbackTile = categoryTilePalette[3 % categoryTilePalette.length];

    const renderer = render(<CategoryIconTile collectionId={3} color={null} icon="Folder" />);

    expect(renderer.root.findByType(FolderIcon).props.color).toBe(fallbackTile.icon);
  });

  it('falls back to the id-deterministic palette when color is omitted entirely', () => {
    const fallbackTile = categoryTilePalette[3 % categoryTilePalette.length];

    const renderer = render(<CategoryIconTile collectionId={3} icon="Folder" />);

    expect(renderer.root.findByType(FolderIcon).props.color).toBe(fallbackTile.icon);
  });

  it('falls back to the id-deterministic palette for an unrecognized color value', () => {
    const fallbackTile = categoryTilePalette[3 % categoryTilePalette.length];

    const renderer = render(<CategoryIconTile collectionId={3} color="NotARealColor" icon="Folder" />);

    expect(renderer.root.findByType(FolderIcon).props.color).toBe(fallbackTile.icon);
  });
});
