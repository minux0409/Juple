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

  it('renders a single confirm button with no cancel button when cancelLabel/onCancel are omitted (alert-only variant)', async () => {
    const onConfirm = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog confirmLabel="OK" message="Something happened." onConfirm={onConfirm} title="Notice" visible />,
      );
    });

    expect(findButton(renderer, 'OK')).toBeTruthy();

    // Android back (onRequestClose) has no separate cancel action to fall back to in this variant,
    // so it resolves the same single action as pressing the confirm button.
    const modal = renderer.root.findByType(Modal);
    await act(async () => {
      modal.props.onRequestClose();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('defaults to a destructive-styled confirm button, and switches to neutral when destructive={false}', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ConfirmDialog
          cancelLabel="Cancel"
          confirmLabel="Continue"
          destructive={false}
          message="Are you sure?"
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
          title="Confirm"
          visible
        />,
      );
    });

    const confirmButton = findButton(renderer, 'Continue');
    const flattenedStyle = [confirmButton.props.style].flat();
    expect(flattenedStyle.some(style => style && 'backgroundColor' in style && style.backgroundColor === '#FF8A8A')).toBe(false);
  });
  describe('dismissable={false}', () => {
    const modalOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Modal)[0];

    async function renderLocked(onConfirm: jest.Mock) {
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(
          <ConfirmDialog confirmLabel="Update" dismissable={false} message="Must update" onConfirm={onConfirm} title="Required" visible />,
        );
      });
      return renderer;
    }

    it('Android back and an outside tap do nothing - they never fall back to the confirm action', async () => {
      const onConfirm = jest.fn();
      const renderer = await renderLocked(onConfirm);

      await act(async () => modalOf(renderer).props.onRequestClose());
      const backdrop = renderer.root.findAll(node => node.props.accessibilityElementsHidden === true && typeof node.props.onPress === 'function')[0];
      await act(async () => backdrop.props.onPress());

      expect(onConfirm).not.toHaveBeenCalled();
      expect(modalOf(renderer).props.visible).toBe(true);
    });

    it('the button still confirms', async () => {
      const onConfirm = jest.fn();
      const renderer = await renderLocked(onConfirm);

      await act(async () => findButton(renderer, 'Update').props.onPress());

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('the default is unchanged: a single-button dialog still answers Back as its confirm', async () => {
      const onConfirm = jest.fn();
      let renderer!: ReactTestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = ReactTestRenderer.create(<ConfirmDialog confirmLabel="OK" message="Notice" onConfirm={onConfirm} title="Notice" visible />);
      });

      await act(async () => modalOf(renderer).props.onRequestClose());

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});
