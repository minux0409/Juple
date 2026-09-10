import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal } from 'react-native';
import { ConfirmDialog } from '../ConfirmDialog';

function findButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

describe('ConfirmDialog', () => {
  it('calls onConfirm when the confirm button is pressed', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete"
          message="Are you sure?"
          onCancel={onCancel}
          onConfirm={onConfirm}
          title="Delete item"
          visible
        />,
      );
    });

    await act(async () => {
      findButton(renderer, 'Delete').props.onPress();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when the cancel button is pressed', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete"
          message="Are you sure?"
          onCancel={onCancel}
          onConfirm={onConfirm}
          title="Delete item"
          visible
        />,
      );
    });

    await act(async () => {
      findButton(renderer, 'Cancel').props.onPress();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when the Modal reports a close request (Android back)', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete"
          message="Are you sure?"
          onCancel={onCancel}
          onConfirm={onConfirm}
          title="Delete item"
          visible
        />,
      );
    });

    const modal = renderer.root.findByType(Modal);
    await act(async () => {
      modal.props.onRequestClose();
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders the given title and message', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Delete"
          message="Are you sure?"
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
          title="Delete item"
          visible
        />,
      );
    });

    expect(renderer.root.findByProps({ children: 'Delete item' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: 'Are you sure?' })).toBeTruthy();
  });
});
