import ReactTestRenderer, { act } from 'react-test-renderer';
import { Appearance, Text } from 'react-native';
import i18n from '../../i18n';
import { DarkModeSwitchRow } from '../../components/DarkModeSwitchRow';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  ThemeProvider,
  applyNativeAppearance,
  loadThemePreference,
  parseThemePreference,
  resolveScheme,
  useTheme,
} from '../ThemeContext';
import { colors, darkColors, getActiveColorScheme, lightColors, setActiveColorScheme, themedStyles } from '../tokens';

const fs = jest.requireActual<{ readFileSync(file: string, encoding: string): string; readdirSync(dir: string): string[] }>('fs');
const path = jest.requireActual<{ resolve(...parts: string[]): string; join(...parts: string[]): string }>('path');

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
  },
}));
let mockSystemScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockSystemScheme }));
jest.mock('react-native-screens', () => {
  const { View } = jest.requireActual('react-native');
  const Passthrough = ({ children }: { children?: unknown }) => <View>{children as never}</View>;
  return { Screen: Passthrough, ScreenStack: Passthrough, ScreenStackItem: Passthrough, ScreenContainer: Passthrough, FullWindowOverlay: Passthrough, enableScreens: () => undefined, screensEnabled: () => true, isSearchBarAvailableForCurrentPlatform: false, compatibilityFlags: {} };
});
jest.mock('react-native-safe-area-context', () => {
  const react = jest.requireActual('react');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    SafeAreaInsetsContext: react.createContext(insets),
    SafeAreaFrameContext: react.createContext(frame),
    SafeAreaProvider: ({ children }: { children?: unknown }) => children,
    initialWindowMetrics: { insets, frame },
  };
});

beforeEach(() => {
  mockStore.clear();
  mockSystemScheme = 'light';
  setActiveColorScheme('light');
  jest.restoreAllMocks();
});

function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('preference and resolution', () => {
  it('defaults to 시스템 설정 사용; unknown stored values are the default', async () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference('purple')).toBe('system');
    expect(await loadThemePreference()).toBe('system');
    mockStore.set(THEME_STORAGE_KEY, 'dark');
    expect(await loadThemePreference()).toBe('dark');
    mockStore.set(THEME_STORAGE_KEY, 'light');
    expect(await loadThemePreference()).toBe('light');
  });

  it('system follows the OS; explicit Light / Dark ignores it', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('tells the OS what the app wants (so status bar, keyboard and dialogs follow), or lets it decide', () => {
    const set = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    applyNativeAppearance('dark');
    applyNativeAppearance('light');
    applyNativeAppearance('system');
    expect(set.mock.calls.map(call => call[0])).toEqual(['dark', 'light', 'auto']);
  });
});

describe('ThemeProvider', () => {
  function Probe({ onTheme }: { onTheme: (state: ReturnType<typeof useTheme>) => void }) {
    onTheme(useTheme());
    return <Text>{colors.background}</Text>;
  }
  async function mount(initial: Parameters<typeof ThemeProvider>[0]['initialPreference']) {
    let latest!: ReturnType<typeof useTheme>;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialPreference={initial}>
          <Probe onTheme={state => { latest = state; }} />
        </ThemeProvider>,
      );
    });
    return { get: () => latest, renderer, update: async (initialPreference: Parameters<typeof ThemeProvider>[0]['initialPreference']) => act(async () => {
      renderer.update(
        <ThemeProvider initialPreference={initialPreference}>
          <Probe onTheme={state => { latest = state; }} />
        </ThemeProvider>,
      );
    }) };
  }

  it('first render is in the stored theme (system+Light, system+Dark, Light over a dark OS, Dark over a light OS)', async () => {
    expect((await mount('system')).get().scheme).toBe('light');
    mockSystemScheme = 'dark';
    expect((await mount('system')).get().scheme).toBe('dark');
    expect((await mount('light')).get().scheme).toBe('light');
    mockSystemScheme = 'light';
    expect((await mount('dark')).get().scheme).toBe('dark');
    expect(getActiveColorScheme()).toBe('dark');
    expect(colors.background).toBe(darkColors.background);
  });

  it('system runtime change is followed while 시스템 설정 사용 and ignored for an explicit choice', async () => {
    const system = await mount('system');
    expect(system.get().isDark).toBe(false);
    mockSystemScheme = 'dark';
    await system.update('system');
    expect(system.get().isDark).toBe(true);

    mockSystemScheme = 'light';
    const explicit = await mount('dark');
    mockSystemScheme = 'dark';
    await explicit.update('dark');
    mockSystemScheme = 'light';
    await explicit.update('dark');
    expect(explicit.get().isDark).toBe(true);
  });

  it('choosing persists it on this device only, and switches the live colours at once', async () => {
    const { get } = await mount('system');
    await act(async () => get().setPreference('dark'));
    expect(get().scheme).toBe('dark');
    expect(mockStore.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(colors.surface).toBe(darkColors.surface);
    await act(async () => get().setPreference('light'));
    expect(colors.surface).toBe(lightColors.surface);
    expect(await loadThemePreference()).toBe('light');
  });

  it('signing out or switching account never touches the device preference', () => {
    const root = path.resolve(__dirname, '../..');
    const auth = fs.readFileSync(path.join(root, 'auth/AuthContext.tsx'), 'utf8');
    expect(auth).not.toMatch(/themePreference|THEME_STORAGE_KEY/);
    expect(auth).not.toMatch(/AsyncStorage\.clear|multiRemove/);
  });
});

describe('semantic tokens', () => {
  it('light and dark define exactly the same roles', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
    expect(Object.keys(colors).sort()).toEqual(Object.keys(lightColors).sort());
  });

  it('themedStyles re-evaluates its factory for the theme in force (and not on every read)', () => {
    let runs = 0;
    const styles = themedStyles(() => {
      runs += 1;
      return { card: { backgroundColor: colors.surface } };
    });
    expect(styles.card).toEqual({ backgroundColor: lightColors.surface });
    expect(styles.card).toEqual({ backgroundColor: lightColors.surface });
    expect(runs).toBe(1);
    setActiveColorScheme('dark');
    expect(styles.card).toEqual({ backgroundColor: darkColors.surface });
    expect(runs).toBe(2);
  });

  it.each([
    ['light', lightColors],
    ['dark', darkColors],
  ] as const)('%s: text, placeholder, links, destructive and badges keep readable contrast', (_name, p) => {
    expect(contrast(p.textPrimary, p.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textPrimary, p.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textSecondary, p.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.placeholder, p.inputBackground)).toBeGreaterThanOrEqual(3.5);
    // The fills are one brand violet and one destructive coral in both themes; text and strokes use their own role tokens.
    // Text >= 4.5:1 and meaningful strokes / icons >= 3:1, on every surface they can sit on.
    for (const surface of [p.surface, p.background, p.surfaceMuted, p.surfaceRaised, p.brandSoft]) {
      expect(contrast(p.brandText, surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const surface of [p.surface, p.background, p.surfaceMuted, p.surfaceRaised, p.dangerSubtle]) {
      expect(contrast(p.dangerText, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.dangerBorder, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(p.brand, p.surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.warningText, p.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.success, p.surface)).toBeGreaterThanOrEqual(4.5);
    // a label on a filled brand / danger control (surface doubles as the label colour)
    expect(contrast(p.onDanger, p.danger)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.onBrand, p.brand)).toBeGreaterThanOrEqual(4.5);
    // the page, the card and the raised sheet are three distinct steps
    expect(p.background).not.toBe(p.surface);
  });

  it('Dark is not flat black: the page, card and raised surface are distinct, near-black steps', () => {
    expect(new Set([darkColors.background, darkColors.surface, darkColors.surfaceRaised, darkColors.surfaceMuted]).size).toBe(4);
    expect(Object.values(darkColors).includes('#000000')).toBe(false);
  });
});

describe('Dark mode row (내 페이지)', () => {
  async function mount(initialPreference: 'system' | 'light' | 'dark', system: 'light' | 'dark' = 'light') {
    await i18n.changeLanguage('ko');
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    mockSystemScheme = system;
    let state!: ReturnType<typeof useTheme>;
    function Capture() {
      state = useTheme();
      return null;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialPreference={initialPreference}>
          <Capture />
          <DarkModeSwitchRow iconStyle={undefined} labelStyle={undefined} rowStyle={undefined} />
        </ThemeProvider>,
      );
    });
    const toggle = () => renderer.root.findAll(node => node.props.testID === 'appearance-dark-mode-switch' && typeof node.props.onValueChange === 'function')[0];
    return { renderer, toggle, getState: () => state };
  }

  it('a single Dark mode switch with the switch role and a label; there is no System / Light / Dark list', async () => {
    const { renderer, toggle } = await mount('light');
    expect(toggle().props.accessibilityRole).toBe('switch');
    expect(toggle().props.accessibilityLabel).toBe('다크 모드');
    expect(toggle().props.accessibilityState.checked).toBe(false);
    expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('appearance-') && node.props.testID !== 'appearance-dark-mode-switch')).toHaveLength(0);
  });

  it('a stored dark is ON and a stored light is OFF', async () => {
    expect((await mount('dark')).toggle().props.value).toBe(true);
    expect((await mount('light')).toggle().props.value).toBe(false);
  });

  it('a stored system choice shows the theme the system currently resolves to, and is not rewritten until the switch is used', async () => {
    const dark = await mount('system', 'dark');
    expect(dark.toggle().props.value).toBe(true);
    expect(mockStore.has(THEME_STORAGE_KEY)).toBe(false);
    expect(dark.getState().preference).toBe('system');
    const light = await mount('system', 'light');
    expect(light.toggle().props.value).toBe(false);
  });

  it('using the switch applies at once and stores an explicit dark / light', async () => {
    const { toggle, getState } = await mount('system', 'light');
    await act(async () => toggle().props.onValueChange(true));
    expect(getState().preference).toBe('dark');
    expect(getState().isDark).toBe(true);
    expect(toggle().props.value).toBe(true);
    expect(mockStore.get(THEME_STORAGE_KEY)).toBe('dark');
    await act(async () => toggle().props.onValueChange(false));
    expect(getState().preference).toBe('light');
    expect(mockStore.get(THEME_STORAGE_KEY)).toBe('light');
  });

  it('a switch from a stored system value to the opposite of what is shown stores the explicit value', async () => {
    const { toggle, getState } = await mount('system', 'dark');
    await act(async () => toggle().props.onValueChange(false));
    expect(getState().preference).toBe('light');
    expect(mockStore.get(THEME_STORAGE_KEY)).toBe('light');
  });
});

describe('localization', () => {
  it('the Appearance labels exist in every language, translated', () => {
    const dir = path.resolve(__dirname, '../../i18n/locales');
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8')).appearance;
    for (const file of fs.readdirSync(dir)) {
      const appearance = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).appearance;
      for (const key of ['title', 'system', 'light', 'dark', 'darkMode']) {
        expect(typeof appearance?.[key]).toBe('string');
        expect(appearance[key].trim().length).toBeGreaterThan(0);
        if (file !== 'en.json') {
          expect(appearance[key]).not.toBe(en[key]);
        }
      }
    }
  });
});

describe('a theme change re-renders what is on screen in place (no remount)', () => {
  const { useState, useEffect } = jest.requireActual<typeof import('react')>('react');
  const { TextInput, View } = jest.requireActual<typeof import('react-native')>('react-native');
  const mounts = { count: 0 };
  const cardStyles = themedStyles(() => ({ card: { backgroundColor: colors.surface } }));

  function Screen() {
    const [text, setText] = useState('');
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return (
      <View style={cardStyles.card} testID="card">
        <TextInput onChangeText={setText} testID="input" value={text} />
      </View>
    );
  }

  async function mountBoundary() {
    mounts.count = 0;
    const { themedScreen: themed } = jest.requireActual<typeof import('../ThemeContext')>('../ThemeContext');
    const Themed = themed(Screen);
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    let captured!: ReturnType<typeof useTheme>;
    function Capture() {
      captured = useTheme();
      return null;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialPreference="system">
          <Capture />
          <Themed />
        </ThemeProvider>,
      );
    });
    const card = () => renderer.root.findByProps({ testID: 'card' }).props.style;
    return { renderer, card, theme: () => captured };
  }

  it('Light -> Dark by the setting: the screen takes the new palette, keeps its typed text, and is not remounted', async () => {
    const { renderer, card, theme } = await mountBoundary();
    await act(async () => renderer.root.findByProps({ testID: 'input' }).props.onChangeText('typed search'));
    expect(card()).toEqual({ backgroundColor: lightColors.surface });

    await act(async () => theme().setPreference('dark'));
    expect(card()).toEqual({ backgroundColor: darkColors.surface });
    expect(renderer.root.findByProps({ testID: 'input' }).props.value).toBe('typed search');
    expect(mounts.count).toBe(1);

    await act(async () => theme().setPreference('light'));
    expect(card()).toEqual({ backgroundColor: lightColors.surface });
    expect(renderer.root.findByProps({ testID: 'input' }).props.value).toBe('typed search');
    expect(mounts.count).toBe(1);
  });

  it('the app contains no remount-on-theme (no key by scheme, no navigation-state replay)', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../../App.tsx'), 'utf8');
    expect(app).not.toMatch(/key=\{scheme\}|initialState|savedState/);
    const root = fs.readFileSync(path.resolve(__dirname, '../../navigation/RootStack.tsx'), 'utf8');
    const tabs = fs.readFileSync(path.resolve(__dirname, '../../navigation/MainTabs.tsx'), 'utf8');
    expect(root).toMatch(/component=\{themedScreen\(MainTabs\)\}/);
    expect(tabs).toMatch(/component=\{themedScreen\(DailyInboxScreen\)\}/);
    // every registered screen goes through it
    expect(root.match(/component=\{(?!themedScreen\()/g)).toBeNull();
    expect(tabs.match(/component=\{(?!themedScreen\()/g)).toBeNull();
    // a wrapper is cached per screen, so re-rendering the navigator never swaps the component type (which would remount it)
    const { themedScreen: themed } = jest.requireActual<typeof import('../ThemeContext')>('../ThemeContext');
    const Dummy = () => null;
    expect(themed(Dummy)).toBe(themed(Dummy));
  });
});

describe('System mode follows the OS at runtime', () => {
  it('system -> explicit -> system: the OS value is used again, and an explicit choice ignores later OS changes', async () => {
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    let theme!: ReturnType<typeof useTheme>;
    function Capture() {
      theme = useTheme();
      return null;
    }
    const tree = (preference: 'system' | 'light' | 'dark') => (
      <ThemeProvider initialPreference={preference}>
        <Capture />
      </ThemeProvider>
    );
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { renderer = ReactTestRenderer.create(tree('system')); });
    expect(theme.scheme).toBe('light');
    mockSystemScheme = 'dark';
    await act(async () => renderer.update(tree('system')));
    expect(theme.scheme).toBe('dark');
    await act(async () => theme.setPreference('light'));
    expect(theme.scheme).toBe('light');
    await act(async () => theme.setPreference('system'));
    expect(theme.scheme).toBe('dark');
    mockSystemScheme = 'light';
    await act(async () => renderer.update(tree('system')));
    expect(theme.scheme).toBe('light');
  });

  it('what is told to the OS: light / dark for an explicit choice, and "auto" (follow the system) for System - never a frozen scheme', async () => {
    const set = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    let theme!: ReturnType<typeof useTheme>;
    function Capture() {
      theme = useTheme();
      return null;
    }
    await act(async () => { ReactTestRenderer.create(<ThemeProvider initialPreference="system"><Capture /></ThemeProvider>); });
    await act(async () => theme.setPreference('dark'));
    await act(async () => theme.setPreference('light'));
    await act(async () => theme.setPreference('system'));
    expect(set.mock.calls.map(call => call[0])).toEqual(['auto', 'dark', 'light', 'auto']);
  });
});

describe('inside a real navigator', () => {
  it('a screen of a native stack keeps its state and route while the theme changes', async () => {
    const { NavigationContainer } = jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native');
    const { createNativeStackNavigator } = jest.requireActual<typeof import('@react-navigation/native-stack')>('@react-navigation/native-stack');
    const { themedScreen } = jest.requireActual<typeof import('../ThemeContext')>('../ThemeContext');
    const react = jest.requireActual<typeof import('react')>('react');
    const rn = jest.requireActual<typeof import('react-native')>('react-native');
    const Stack = createNativeStackNavigator();
    const styles = themedStyles(() => ({ card: { backgroundColor: colors.surface } }));
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
    let theme!: ReturnType<typeof useTheme>;
    let mounted = 0;
    function Capture() {
      theme = useTheme();
      return null;
    }
    function Second() {
      const [text, setText] = react.useState('');
      react.useEffect(() => { mounted += 1; }, []);
      return <rn.View style={styles.card} testID="second"><rn.TextInput onChangeText={setText} testID="field" value={text} /></rn.View>;
    }
    function First() {
      return <rn.View testID="first" />;
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialPreference="light">
          <Capture />
          <NavigationContainer>
            <Stack.Navigator initialRouteName="Second">
              <Stack.Screen component={themedScreen(First)} name="First" />
              <Stack.Screen component={themedScreen(Second)} name="Second" />
            </Stack.Navigator>
          </NavigationContainer>
        </ThemeProvider>,
      );
    });
    await act(async () => renderer.root.findByProps({ testID: 'field' }).props.onChangeText('draft'));
    await act(async () => theme.setPreference('dark'));
    expect(renderer.root.findByProps({ testID: 'second' }).props.style).toEqual({ backgroundColor: darkColors.surface });
    expect(renderer.root.findByProps({ testID: 'field' }).props.value).toBe('draft');
    expect(mounted).toBe(1);
  });
});

describe('Android navigation bar follows the resolved theme (live)', () => {
  const { NativeModules, Platform } = jest.requireActual<typeof import('react-native')>('react-native');
  const setBar = jest.fn();
  let originalOs: typeof Platform.OS;

  beforeEach(() => {
    setBar.mockClear();
    originalOs = Platform.OS;
    (Platform as { OS: string }).OS = 'android';
    (NativeModules as Record<string, unknown>).JupleSystemBars = { setNavigationBarTheme: setBar };
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
  });
  afterEach(() => {
    (Platform as { OS: string }).OS = originalOs;
    delete (NativeModules as Record<string, unknown>).JupleSystemBars;
  });

  async function mountWith(initial: 'system' | 'light' | 'dark') {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ThemeProvider initialPreference={initial}><Text>x</Text></ThemeProvider>);
    });
    return renderer;
  }
  const update = (renderer: ReactTestRenderer.ReactTestRenderer, initial: 'system' | 'light' | 'dark') =>
    act(async () => {
      renderer.update(<ThemeProvider initialPreference={initial}><Text>x</Text></ThemeProvider>);
    });

  it('Dark: light icons on the dark tab-bar surface; Light: dark icons on the light surface', async () => {
    await mountWith('dark');
    expect(setBar).toHaveBeenLastCalledWith(true, darkColors.surface);
    setBar.mockClear();
    await mountWith('light');
    expect(setBar).toHaveBeenLastCalledWith(false, lightColors.surface);
  });

  it('an OS theme flip while on 시스템 설정 사용 updates the bar at once; an explicit choice ignores the OS', async () => {
    const system = await mountWith('system');
    expect(setBar).toHaveBeenLastCalledWith(false, lightColors.surface);
    mockSystemScheme = 'dark';
    await update(system, 'system');
    expect(setBar).toHaveBeenLastCalledWith(true, darkColors.surface);

    const explicit = await mountWith('light');
    setBar.mockClear();
    mockSystemScheme = 'light';
    await update(explicit, 'light');
    mockSystemScheme = 'dark';
    await update(explicit, 'light');
    expect(setBar).not.toHaveBeenCalledWith(true, expect.anything());
  });

  it('does nothing on iOS or when the native module is missing', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await mountWith('dark');
    expect(setBar).not.toHaveBeenCalled();
    (Platform as { OS: string }).OS = 'android';
    delete (NativeModules as Record<string, unknown>).JupleSystemBars;
    await expect(mountWith('dark')).resolves.toBeDefined();
  });

  it('the native side sets icon appearance, background and contrast on the window, with no extra dependency', () => {
    const kt = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'com.juple.app', 'JupleSystemBarsModule.kt'), 'utf8');
    expect(kt).toContain('isAppearanceLightNavigationBars = !isDark');
    expect(kt).toContain('isNavigationBarContrastEnforced = false');
    expect(kt).toContain('runOnUiThread');
  });
});
