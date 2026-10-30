import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, StyleSheet, TextInput } from 'react-native';
import { colors } from '../../theme/tokens';
import { launchImageLibrary } from 'react-native-image-picker';
import i18n from '../../i18n';
import { CategoryEditorDialog } from '../CategoryEditorDialog';
import { PhotoCropper } from '../../images/PhotoCropper';

jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

async function renderDialog(overrides: Partial<React.ComponentProps<typeof CategoryEditorDialog>> = {}) {
  const props: React.ComponentProps<typeof CategoryEditorDialog> = {
    visible: true,
    mode: 'create',
    initialName: '',
    initialIcon: 'Folder',
    initialColor: 'Blue',
    isSubmitting: false,
    error: null,
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CategoryEditorDialog {...props} />);
  });
  return { renderer, props };
}

describe('CategoryEditorDialog', () => {
  afterEach(() => jest.clearAllMocks());

  describe('own photo as the icon', () => {
    const picked = { uri: 'file:///picked.jpg', type: 'image/jpeg', fileName: 'picked.jpg' };
    const previewImages = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findAllByType(Image).map(image => image.props.source?.uri);

    it('picks a working copy, fits it in the crop screen (the tile\'s rounded square), previews the crop and submits it as the icon photo', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValue({ didCancel: false, assets: [picked] } as never);
      const { renderer, props } = await renderDialog();
      act(() => renderer.root.findByType(TextInput).props.onChangeText('여행'));

      await act(async () => {
        await renderer.root.findByProps({ testID: 'collection-editor-choose-photo' }).props.onPress();
      });

      expect(launchImageLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'photo', maxWidth: 1600, maxHeight: 1600, selectionLimit: 1 }));
      // Not used as it is: the crop screen opens first.
      const cropper = renderer.root.findByType(PhotoCropper);
      expect(cropper.props.variant).toBe('collection');
      expect(cropper.props.uri).toBe('file:///picked.jpg');
      const cropped = { uri: 'file:///cropped.jpg', type: 'image/jpeg', fileName: 'collection.jpg' };
      act(() => cropper.props.onApply(cropped));
      expect(renderer.root.findAllByType(PhotoCropper)).toHaveLength(0);
      expect(previewImages(renderer)).toContain('file:///cropped.jpg');
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('여행', 'Folder', 'Blue', { kind: 'set', asset: cropped });
    });

    it('cancelling the crop leaves the photo unchanged', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValue({ didCancel: false, assets: [picked] } as never);
      const { renderer, props } = await renderDialog({ mode: 'edit', initialName: '기존' });
      await act(async () => {
        await renderer.root.findByProps({ testID: 'collection-editor-choose-photo' }).props.onPress();
      });
      act(() => renderer.root.findByType(PhotoCropper).props.onCancel());
      expect(renderer.root.findAllByType(PhotoCropper)).toHaveLength(0);
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('기존', 'Folder', 'Blue', { kind: 'keep' });
    });

    it('a cancelled or failed pick changes nothing (a failure says why)', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValueOnce({ didCancel: true } as never);
      const { renderer, props } = await renderDialog({ mode: 'edit', initialName: '기존' });
      const choose = () => act(async () => {
        await renderer.root.findByProps({ testID: 'collection-editor-choose-photo' }).props.onPress();
      });
      await choose();
      jest.mocked(launchImageLibrary).mockResolvedValueOnce({ errorCode: 'permission' } as never);
      await choose();

      expect(renderer.root.findAll(node => node.props.children === i18n.t('item.errorImagePickerPermission')).length).toBeGreaterThan(0);
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('기존', 'Folder', 'Blue', { kind: 'keep' });
    });

    it('an existing photo can be removed - back to the built-in icon', async () => {
      const { renderer, props } = await renderDialog({ mode: 'edit', initialName: '기존', initialImageUrl: 'https://blob.example.test/icon.jpg' });
      expect(previewImages(renderer)).toContain('https://blob.example.test/icon.jpg');

      act(() => renderer.root.findByProps({ testID: 'collection-editor-remove-photo' }).props.onPress());

      expect(previewImages(renderer)).not.toContain('https://blob.example.test/icon.jpg');
      expect(renderer.root.findAll(node => node.props.testID === 'collection-editor-remove-photo')).toHaveLength(0);
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('기존', 'Folder', 'Blue', { kind: 'remove' });
    });

    it('choosing a built-in icon while a photo is set means "use this icon" - the photo goes', async () => {
      const { renderer, props } = await renderDialog({ mode: 'edit', initialName: '기존', initialImageUrl: 'https://blob.example.test/icon.jpg' });

      act(() => renderer.root.findByProps({ testID: 'collection-icon-option-Plane' }).props.onPress());
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());

      expect(props.onSubmit).toHaveBeenCalledWith('기존', 'Plane', 'Blue', { kind: 'remove' });
    });

    it('without a photo, reopening the editor keeps whatever photo the Collection has', async () => {
      const { renderer, props } = await renderDialog({ mode: 'edit', initialName: '기존', initialImageUrl: 'https://blob.example.test/icon.jpg' });
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('기존', 'Folder', 'Blue', { kind: 'keep' });
    });
  });

  it('renders the create form and submits the typed name with selected icon and color', async () => {
    const { renderer, props } = await renderDialog();
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('여행'));
    act(() => renderer.root.findByProps({ testID: 'collection-icon-option-Plane' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'collection-color-option-Mint' }).props.onPress());
    act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') }).props.onPress());

    expect(props.onSubmit).toHaveBeenCalledWith('여행', 'Plane', 'Mint', { kind: 'keep' });
  });

  it('prefills edit values and submits their edited values', async () => {
    const { renderer, props } = await renderDialog({
      mode: 'edit', initialName: '기존', initialIcon: 'Heart', initialColor: 'Teal',
    });
    const input = renderer.root.findByType(TextInput);
    expect(input.props.value).toBe('기존');
    expect(renderer.root.findByProps({ testID: 'collection-icon-option-Heart' }).props.accessibilityState.selected).toBe(true);
    expect(renderer.root.findByProps({ testID: 'collection-color-option-Teal' }).props.accessibilityState.selected).toBe(true);

    act(() => input.props.onChangeText('변경'));
    act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.save') }).props.onPress());
    expect(props.onSubmit).toHaveBeenCalledWith('변경', 'Heart', 'Teal', { kind: 'keep' });
  });

  it('restores and submits an existing custom hex color through the hue picker', async () => {
    const { renderer, props } = await renderDialog({ initialColor: '#B5D8F1', initialName: 'Custom' });
    expect(renderer.root.findAllByProps({ testID: 'collection-color-hue-thumb' }).length).toBeGreaterThan(0);
    act(() => renderer.root.findByProps({ testID: 'collection-color-hue-bar' }).props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    // pageX (not locationX) drives the hue calculation now - see CollectionColorPicker's own
    // remarks on why locationX was the real-device drag-jump bug. react-test-renderer never
    // attaches a real ref to host components (no createNodeMock here), so measureInWindow's
    // callback never fires and barPageLeftRef stays 0 - pageX alone is the effective offset here.
    act(() => renderer.root.findByProps({ testID: 'collection-color-hue-bar' }).props.onResponderGrant({ nativeEvent: { pageX: 100 } }));
    act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') }).props.onPress());
    expect((props.onSubmit as jest.Mock).mock.calls[0][2]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('cancels without submitting', async () => {
    const { renderer, props } = await renderDialog();
    act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('common.cancel') }).props.onPress());
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('has no visible form or mutation side effect when hidden', async () => {
    const { renderer, props } = await renderDialog({ visible: false });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});

describe('CategoryEditorDialog - nothing of the screen behind looks like part of the card', () => {
  it('the backdrop is the theme scrim and the card has its own edge and clips its content to its rounded corners', async () => {
    const { renderer } = await renderDialog();
    const card = renderer.root.findAll(node => node.props.accessibilityViewIsModal === true && typeof node.type === 'string')[0];
    const cardStyle = StyleSheet.flatten(card.props.style);
    expect(cardStyle).toEqual(expect.objectContaining({ overflow: 'hidden', borderWidth: 1, borderColor: colors.inputBorder }));
    const backdrops = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.backgroundColor === colors.scrim);
    expect(backdrops.length).toBeGreaterThan(0);
    // The old fixed, lighter backdrop is gone.
    expect(renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.backgroundColor === 'rgba(0, 0, 0, 0.4)')).toHaveLength(0);
  });
});

describe('CategoryEditorDialog - opening and the icon grid', () => {
  it('opens without focusing the name field - the keyboard comes only when the person taps it', async () => {
    const { renderer } = await renderDialog();
    expect(renderer.root.findByType(TextInput).props.autoFocus).toBeFalsy();
  });

  it('every built-in icon is a square tile (as wide as it is tall, sized from the grid), two rows shown at a time', async () => {
    const { renderer } = await renderDialog();
    const grid = renderer.root.findAll(node => node.props.testID === 'collection-icon-grid' && typeof node.props.onLayout === 'function')[0];
    act(() => grid.props.onLayout({ nativeEvent: { layout: { width: 320, height: 200, x: 0, y: 0 } } }));
    const byId = new Map<string, ReactTestRenderer.ReactTestInstance>();
    for (const node of renderer.root.findAll(candidate => /^collection-icon-option-\w+$/.test(String(candidate.props.testID ?? '')) && typeof candidate.type === 'string')) {
      if (!byId.has(node.props.testID)) {
        byId.set(node.props.testID, node);
      }
    }
    expect(byId.size).toBeGreaterThanOrEqual(10);
    for (const cell of byId.values()) {
      const style = StyleSheet.flatten(cell.props.style);
      expect(style.width).toBe(style.height);
      expect(style.width).toBe(Math.floor(320 * 0.18));
      expect(style.width).toBeGreaterThanOrEqual(44);
    }
    // Exactly two rows of those tiles are visible (the rest scroll).
    const gridHost = renderer.root.findAll(node => node.props.testID === 'collection-icon-grid' && typeof node.type === 'string')[0];
    expect(StyleSheet.flatten(gridHost.props.style).maxHeight).toBe(Math.floor(320 * 0.18) * 2 + 8 + 4);
  });
});

describe('CategoryEditorDialog - never rises into the screen title row', () => {
  it('keeps 64pt below the safe area free, so the controls of the screen behind (its "+") stay covered by the scrim, not beside the card', async () => {
    const { renderer } = await renderDialog();
    const paddings = renderer.root
      .findAll(node => StyleSheet.flatten(node.props.style)?.backgroundColor === colors.scrim)
      .map(node => StyleSheet.flatten(node.props.style).paddingTop)
      .filter((value): value is number => typeof value === 'number');
    expect(Math.max(...paddings)).toBeGreaterThanOrEqual(64);
  });
});
