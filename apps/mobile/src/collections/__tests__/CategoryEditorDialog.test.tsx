import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import i18n from '../../i18n';
import { CategoryEditorDialog } from '../CategoryEditorDialog';

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

  it('renders the create form and submits the typed name with selected icon and color', async () => {
    const { renderer, props } = await renderDialog();
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('여행'));
    act(() => renderer.root.findByProps({ testID: 'collection-icon-option-Plane' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'collection-color-option-Mint' }).props.onPress());
    act(() => renderer.root.findByProps({ accessibilityLabel: i18n.t('collections.createAction') }).props.onPress());

    expect(props.onSubmit).toHaveBeenCalledWith('여행', 'Plane', 'Mint');
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
    expect(props.onSubmit).toHaveBeenCalledWith('변경', 'Heart', 'Teal');
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
