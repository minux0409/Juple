import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, TextInput } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { launchImageLibrary } from 'react-native-image-picker';
import i18n from '../../i18n';
import { CategoryEditorDialog, restingDialogFrame } from '../CategoryEditorDialog';
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

describe('CategoryEditorDialog - the card stays put while the keyboard comes and goes', () => {
  const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  const host = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && typeof node.type === 'string')[0];
  /** Where the card sits in the window (what the keyboard's overlap is measured from). */
  const placeCardInWindow = (renderer: ReactTestRenderer.ReactTestRenderer, y: number) => {
    const card = renderer.root.findAll(node => node.props.testID === 'collection-editor-card' && typeof node.type !== 'string' && node.instance?.measureInWindow)[0];
    card.instance.measureInWindow = (callback: (x: number, windowY: number) => void) => callback(20, y);
  };
  const cardStyle = (renderer: ReactTestRenderer.ReactTestRenderer) => StyleSheet.flatten(host(renderer, 'collection-editor-card').props.style);

  function captureKeyboard() {
    const handlers = new Map<string, (event: unknown) => void>();
    const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: (event: unknown) => void) => {
      handlers.set(name, handler);
      return { remove: jest.fn() };
    }) as never);
    return { handlers, spy };
  }

  async function renderPlaced() {
    const { handlers, spy } = captureKeyboard();
    const { renderer } = await renderDialog();
    act(() => host(renderer, 'collection-editor-area').props.onLayout(layout(360, 800)));
    act(() => host(renderer, 'collection-editor-card').props.onLayout(layout(360, 500)));
    return { renderer, handlers, spy };
  }

  it('rests centred and never taller than the area', () => {
    expect(restingDialogFrame(800, 500)).toEqual({ top: 150, maxHeight: 800 });
    expect(restingDialogFrame(400, 500)).toEqual({ top: 0, maxHeight: 400 });
  });

  it('a tap on an icon with the keyboard up selects it the first time (the grid does not spend it on closing the keyboard)', async () => {
    const { renderer } = await renderDialog();
    const grid = renderer.root.findAll(node => node.props.testID === 'collection-icon-grid' && node.props.keyboardShouldPersistTaps !== undefined)[0];
    expect(grid.props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('uses no keyboard-avoiding container: nothing resizes with the keyboard', async () => {
    const { renderer, spy } = await renderPlaced();
    expect(renderer.root.findAllByType(KeyboardAvoidingView)).toHaveLength(0);
    spy.mockRestore();
  });

  it('with the keyboard: the same top, no maxHeight change and only room added at the end of the form; the buttons scroll with it', async () => {
    const { renderer, handlers, spy } = await renderPlaced();
    const before = cardStyle(renderer);
    expect(before).toEqual(expect.objectContaining({ marginTop: 150, maxHeight: 800 }));
    // The card ends at 750 in the window; the keyboard starts at 560: 190 covered.
    placeCardInWindow(renderer, 250);
    act(() => handlers.get('keyboardWillShow')!({ endCoordinates: { screenY: 560 } }));

    expect(cardStyle(renderer)).toEqual(expect.objectContaining({ marginTop: 150, maxHeight: 800, height: 500 }));
    expect(StyleSheet.flatten(host(renderer, 'collection-editor-keyboard-room').props.style).height).toBe(190 + spacing.md);
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.findAll(node => node.props.testID === 'collection-editor-keyboard-room').length).toBeGreaterThan(0);
    expect(scroll.findAll(node => node.props.accessibilityLabel === i18n.t('common.cancel')).length).toBeGreaterThan(0);

    // A drag on the icon grid moves the form, so the buttons can be reached from anywhere.
    expect(renderer.root.findAll(node => node.props.testID === 'collection-icon-grid' && node.props.scrollEnabled === false).length).toBeGreaterThan(0);

    // Measurements while it is up (a window that resized, a capped card) change nothing.
    act(() => host(renderer, 'collection-editor-area').props.onLayout(layout(360, 400)));
    act(() => host(renderer, 'collection-editor-card').props.onLayout(layout(360, 200)));
    expect(cardStyle(renderer)).toEqual(expect.objectContaining({ marginTop: 150, maxHeight: 800, height: 500 }));

    act(() => handlers.get('keyboardWillHide')!({}));
    expect(cardStyle(renderer).marginTop).toBe(150);
    expect(cardStyle(renderer).height).toBeUndefined();
    expect(host(renderer, 'collection-editor-keyboard-room')).toBeUndefined();
    spy.mockRestore();
  });

  it('a keyboard that covers nothing of the card adds nothing', async () => {
    const { renderer, handlers, spy } = await renderPlaced();
    placeCardInWindow(renderer, 100);
    act(() => handlers.get('keyboardWillShow')!({ endCoordinates: { screenY: 700 } }));
    expect(host(renderer, 'collection-editor-keyboard-room')).toBeUndefined();
    spy.mockRestore();
  });

  it('what was typed survives the keyboard', async () => {
    const { renderer, handlers, spy } = await renderPlaced();
    act(() => renderer.root.findByType(TextInput).props.onChangeText('이름'));
    act(() => handlers.get('keyboardWillShow')!({ endCoordinates: { screenY: 560 } }));
    act(() => handlers.get('keyboardWillHide')!({}));
    expect(renderer.root.findByType(TextInput).props.value).toBe('이름');
    spy.mockRestore();
  });

  it('the area lets taps beside the card reach the backdrop, which closes the dialog', async () => {
    const { renderer } = await renderDialog();
    expect(host(renderer, 'collection-editor-area').props.pointerEvents).toBe('box-none');
  });
});
