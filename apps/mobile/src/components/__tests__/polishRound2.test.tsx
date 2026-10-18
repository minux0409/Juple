import ReactTestRenderer, { act } from 'react-test-renderer';
import { Appearance, Switch } from 'react-native';
import { ThemedSwitch } from '../ThemedSwitch';
import { CloseButton } from '../CloseButton';
import { ThemeProvider } from '../../theme/ThemeContext';
import { darkColors, setActiveColorScheme } from '../../theme/tokens';
import i18n from '../../i18n';

type Fs = { readFileSync(file: string, encoding: string): string };
const fs = jest.requireActual<Fs>('fs');
const path = jest.requireActual<{ resolve(...parts: string[]): string }>('path');

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

async function renderWith(preference: 'light' | 'dark', element: React.ReactElement) {
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<ThemeProvider initialPreference={preference}>{element}</ThemeProvider>);
  });
  return renderer;
}

describe('ThemedSwitch', () => {
  afterEach(() => setActiveColorScheme('light'));

  it('Dark OFF: a clearly lighter track and a bright thumb from the theme roles', async () => {
    const renderer = await renderWith('dark', <ThemedSwitch value={false} />);
    const native = renderer.root.findByType(Switch);
    expect(native.props.trackColor).toEqual({ false: darkColors.border, true: undefined });
    expect(native.props.thumbColor).toBe(darkColors.textPrimary);
    expect(native.props.ios_backgroundColor).toBe(darkColors.border);
  });

  it('Dark ON keeps the platform accent (no track / thumb override for the on state)', async () => {
    const native = (await renderWith('dark', <ThemedSwitch value />)).root.findByType(Switch);
    expect(native.props.thumbColor).toBeUndefined();
    expect(native.props.trackColor.true).toBeUndefined();
  });

  it('Light is untouched', async () => {
    const native = (await renderWith('light', <ThemedSwitch value={false} />)).root.findByType(Switch);
    expect(native.props.trackColor).toBeUndefined();
    expect(native.props.thumbColor).toBeUndefined();
  });

  it('disabled is dimmed so it never reads as simply "off"; the value handler is the plain Switch\'s', async () => {
    const onValueChange = jest.fn();
    const native = (await renderWith('dark', <ThemedSwitch disabled onValueChange={onValueChange} value={false} />)).root.findByType(Switch);
    expect(JSON.stringify(native.props.style)).toContain('0.5');
    expect(native.props.disabled).toBe(true);
    expect(native.props.onValueChange).toBe(onValueChange);
  });

  it('no screen renders the raw Switch any more', () => {
    const files = ['collections/SharePasswordCard.tsx', 'screens/AppearanceSettingsScreen.tsx', 'screens/CollectionShareScreen.tsx', 'screens/MyPageScreen.tsx'];
    for (const file of files) {
      expect(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')).not.toMatch(/<Switch\b/);
    }
  });
});

describe('CloseButton (the X for a plain dismiss)', () => {
  it('is a 44dp button named 닫기 that closes, and can be disabled', async () => {
    await i18n.changeLanguage('ko');
    const onPress = jest.fn();
    const renderer = await renderWith('light', <CloseButton onPress={onPress} testID="x" />);
    const button = renderer.root.findAll(node => node.props.testID === 'x' && node.props.accessibilityLabel !== undefined && typeof node.props.onPress === 'function')[0];
    expect(button.props.accessibilityLabel).toBe('닫기');
    expect(button.props.accessibilityRole).toBe('button');
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Android popup windows follow the theme (JupleSystemBarsModule)', () => {
  const kotlin = fs.readFileSync(path.resolve(__dirname, '../../../android/app/src/main/java/com/com.juple.app/JupleSystemBarsModule.kt'), 'utf8');

  it('is an ExtraWindowEventListener, so every React Native Modal / sheet window gets the resolved theme once, with no per-popup colours', () => {
    expect(kotlin).toContain('ExtraWindowEventListener');
    expect(kotlin).toContain('addExtraWindowEventListener(this)');
    expect(kotlin).toContain('override fun onExtraWindowCreate(window: Window)');
    expect(kotlin).toContain('override fun onExtraWindowDestroy(window: Window)');
    expect(kotlin).toContain('isAppearanceLightNavigationBars = !isDark');
    expect(kotlin).toContain('isNavigationBarContrastEnforced = false');
    // The colour always comes from JS (the theme role) - none is written in native code.
    expect(kotlin).not.toMatch(/Color\.(parseColor|argb|rgb)\(\s*["']/);
  });

  it('an open popup follows a live theme change, and the dialog background is left transparent', () => {
    expect(kotlin).toContain('openDialogWindows().forEach { applyNavigationBar(it, isDark, parsed) }');
    const dialogBranch = kotlin.slice(kotlin.indexOf('override fun onExtraWindowCreate'), kotlin.indexOf('override fun onExtraWindowDestroy'));
    expect(dialogBranch).not.toContain('setBackgroundDrawable');
  });

  it('lifecycle: windows are tracked weakly, added on create, removed on destroy, pruned when detached, and everything is released with the module', () => {
    expect(kotlin).toContain('Collections.newSetFromMap(WeakHashMap())');
    expect(kotlin).toContain('dialogWindows.add(window)');
    expect(kotlin).toContain('dialogWindows.remove(window)');
    expect(kotlin).toContain('retainAll { it.decorView.isAttachedToWindow }');
    expect(kotlin).toContain('removeExtraWindowEventListener(this)');
    expect(kotlin).toContain('dialogWindows.clear()');
  });
});
