import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { CollectionHeaderTitle } from '../CollectionHeaderTitle';
import { CategoryIconTile } from '../CategoryIconTile';

function render(name: string, isLocked = false) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <CollectionHeaderTitle collectionId={7} color={null} icon="Folder" isLocked={isLocked} name={name} />,
    );
  });
  return renderer;
}

describe('CollectionHeaderTitle', () => {
  it('shows the Collection icon and caps a long title at two lines', () => {
    const name = 'A'.repeat(300);
    const renderer = render(name);
    const title = renderer.root.findByProps({ testID: 'collection-details-title' });

    expect(renderer.root.findAllByType(CategoryIconTile)).toHaveLength(1);
    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.ellipsizeMode).toBe('tail');
    expect(title.props.accessibilityLabel).toBe(name);
    act(() => renderer.unmount());
  });

  it('keeps the icon (and the lock) from shrinking and shows the lock only for a locked Collection', () => {
    const open = render('Trip');
    expect(open.root.findAllByProps({ testID: 'collection-details-locked' })).toHaveLength(0);
    const locked = render('Trip', true);
    expect(locked.root.findAllByProps({ testID: 'collection-details-locked' }).length).toBeGreaterThan(0);
    expect(locked.root.findAllByType(Text).some(text => text.props.children === 'Trip')).toBe(true);
    act(() => { open.unmount(); locked.unmount(); });
  });
});
