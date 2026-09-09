import ReactTestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import '../../i18n';
import { RowActionSheet } from '../RowActionSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

async function renderSheet(props: {
  onClose: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <RowActionSheet
        onClose={props.onClose}
        onDelete={props.onDelete}
        onShare={props.onShare}
        visible
      />,
    );
  });
  return renderer;
}

// Matches by the presence of an onPress prop rather than findAllByType(Pressable) - RN's
// Pressable export and the JSX element's resolved type are not always the exact same reference
// under this app's Jest/Babel setup, so type-based matching silently returns nothing.
function findPressables(renderer: ReactTestRenderer.ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAll(node => typeof node.props.onPress === 'function');
}

describe('RowActionSheet', () => {
  it('calls onShare and onClose when the share row is pressed', async () => {
    const onClose = jest.fn();
    const onShare = jest.fn();
    const onDelete = jest.fn();
    const renderer = await renderSheet({ onClose, onShare, onDelete });

    const [, sharePressable] = findPressables(renderer);
    await act(async () => {
      sharePressable.props.onPress();
    });

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls onDelete and onClose when the delete row is pressed', async () => {
    const onClose = jest.fn();
    const onShare = jest.fn();
    const onDelete = jest.fn();
    const renderer = await renderSheet({ onClose, onShare, onDelete });

    const [, , deletePressable] = findPressables(renderer);
    await act(async () => {
      deletePressable.props.onPress();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('calls onClose when the overlay is pressed', async () => {
    const onClose = jest.fn();
    const renderer = await renderSheet({ onClose, onShare: jest.fn(), onDelete: jest.fn() });

    const [overlayPressable] = findPressables(renderer);
    await act(async () => {
      overlayPressable.props.onPress();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
