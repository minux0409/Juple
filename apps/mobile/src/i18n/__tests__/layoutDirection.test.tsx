import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import i18n from '../index';
import { LayoutDirectionRoot, layoutDirectionFor, useLayoutDirection } from '../layoutDirection';
import { ThemeProvider, useTheme } from '../../theme/ThemeContext';
import { darkColors, lightColors } from '../../theme/tokens';

function Probe() {
  return <Text testID="probe">{useLayoutDirection()}</Text>;
}

const rootDirection = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  StyleSheet.flatten(renderer.root.findByProps({ testID: 'layout-direction-root' }).findByType(View).props.style).direction;

describe('layout direction follows the selected app language, in the same session', () => {
  const originalIsRTL = I18nManager.isRTL;

  afterEach(async () => {
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: originalIsRTL });
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('maps only RTL languages to rtl', () => {
    expect(layoutDirectionFor('ar')).toBe('rtl');
    for (const language of ['ko', 'ja', 'en', 'de', 'zh-Hans', undefined]) {
      expect(layoutDirectionFor(language)).toBe('ltr');
    }
  });

  it.each([
    ['ko'],
    ['ja'],
    ['en'],
  ])('%s → ar → %s flips to RTL and back to LTR without remounting or restarting', async language => {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <LayoutDirectionRoot>
          <Probe />
        </LayoutDirectionRoot>,
      );
    });
    const probeInstance = renderer.root.findByProps({ testID: 'probe' });
    expect(rootDirection(renderer)).toBe('ltr');

    await act(async () => {
      await i18n.changeLanguage('ar');
    });
    expect(rootDirection(renderer)).toBe('rtl');
    expect(renderer.root.findByProps({ testID: 'probe' }).props.children).toBe('rtl');

    // The native flag stays RTL for the rest of this process (forceRTL only applies on the next
    // launch) - the layout must not depend on it.
    Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    expect(rootDirection(renderer)).toBe('ltr');
    expect(renderer.root.findByProps({ testID: 'probe' }).props.children).toBe('ltr');
    // Same tree the whole time - nothing was remounted to get there.
    expect(renderer.root.findByProps({ testID: 'probe' })).toBe(probeInstance);
  });
});

describe('the app root (what iOS push / pop transitions reveal behind the moving screen) follows a theme change made while running', () => {
  function ThemeSwitch({ onReady }: { readonly onReady: (set: (preference: 'light' | 'dark') => void) => void }) {
    onReady(useTheme().setPreference);
    return null;
  }

  it('repaints its background on Light -> Dark -> Light although its own props never change', () => {
    let setPreference!: (preference: 'light' | 'dark') => void;
    // The same children element on every render, like App's tree: React skips a component that does not subscribe.
    const content = <View testID="content" />;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ThemeProvider initialPreference="light">
          <ThemeSwitch onReady={set => { setPreference = set; }} />
          <LayoutDirectionRoot>{content}</LayoutDirectionRoot>
        </ThemeProvider>,
      );
    });
    const background = () => StyleSheet.flatten(renderer.root.findByProps({ testID: 'layout-direction-root' }).findByType(View).props.style).backgroundColor;

    expect(background()).toBe(lightColors.background);
    act(() => setPreference('dark'));
    expect(background()).toBe(darkColors.background);
    act(() => setPreference('light'));
    expect(background()).toBe(lightColors.background);
  });
});
