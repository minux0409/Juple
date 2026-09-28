import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, TextInput } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import i18n from '../../i18n';
import { CategoryEditorDialog } from '../CategoryEditorDialog';

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

    it('picks a resized photo, previews it, and submits it as the new icon photo', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValue({ didCancel: false, assets: [picked] } as never);
      const { renderer, props } = await renderDialog();
      act(() => renderer.root.findByType(TextInput).props.onChangeText('여행'));

      await act(async () => {
        await renderer.root.findByProps({ testID: 'collection-editor-choose-photo' }).props.onPress();
      });

      expect(launchImageLibrary).toHaveBeenCalledWith(expect.objectContaining({ mediaType: 'photo', maxWidth: 512, maxHeight: 512, selectionLimit: 1 }));
      expect(previewImages(renderer)).toContain('file:///picked.jpg');
      act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') }).props.onPress());
      expect(props.onSubmit).toHaveBeenCalledWith('여행', 'Folder', 'Blue', { kind: 'set', asset: picked });
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
