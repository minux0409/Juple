import ReactTestRenderer, { act } from 'react-test-renderer';
import { Linking, Platform, Text, StyleSheet, View } from 'react-native';
import { WebAppBanner } from '../WebAppBanner';
import { ConfirmDialog } from '../ConfirmDialog';
import i18n from '../../i18n';
import { lightColors, darkColors, radii, spacing, setActiveColorScheme } from '../../theme/tokens';

// Exercise the real rounded PressedLayer rather than the default screen-test Pressable mock.
jest.mock('../Pressable', () => jest.requireActual('../Pressable'));

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

async function renderBanner() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<WebAppBanner />); });
  return renderer;
}
// As in Pressable.test: the first node is the app wrapper, the second is the native Pressable.
const button = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'my-web-banner')[1];

it('makes the whole existing banner an accessible button without changing its words or illustration', async () => {
  await i18n.changeLanguage('ko');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<WebAppBanner />); });
  const text = renderer.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Juple은 웹에서도 이용할 수 있어요');
  expect(text).toContain('PC에서도 저장한 링크와 컬렉션을 편리하게 관리해 보세요.');
  expect(text).toContain('juple.co.kr');
  expect(renderer.root.findAll(node => node.props.testID === 'web-banner-official-logo').length).toBeGreaterThan(0);
  expect(button(renderer).props.accessibilityRole).toBe('button');
  expect(button(renderer).props.accessibilityLabel).toBe('링크 열기: Juple (juple.co.kr)');
  expect(button(renderer).findAllByType(Text)).toHaveLength(3);
  expect(StyleSheet.flatten(button(renderer).props.style)).toMatchObject({ borderRadius: radii.lg, padding: spacing.lg, marginTop: spacing.lg, overflow: 'hidden', flexDirection: 'row' });
  await act(async () => renderer.unmount());
});

it.each([['light', lightColors], ['dark', darkColors]] as const)('%s uses the theme palette and a fixed illustration beside flexible wrapping text', async (scheme, palette) => {
  setActiveColorScheme(scheme);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = ReactTestRenderer.create(<WebAppBanner />); });
    const banner = renderer.root.findAll(node => node.props.testID === 'my-web-banner')[0];
    expect(StyleSheet.flatten(banner.props.style).backgroundColor).toBe(palette.brandSoft);
    const browser = renderer.root.findAll(node => node.props.testID === 'web-banner-browser')[0];
    expect(StyleSheet.flatten(browser.props.style).flexShrink).toBe(0);
    const domain = renderer.root.findAllByType(Text).find(node => node.props.children === 'juple.co.kr')!;
    expect(StyleSheet.flatten(domain.props.style).color).toBe(palette.brandText);
    await act(async () => renderer.unmount());
  } finally { setActiveColorScheme('light'); }
});

it.each(['android', 'ios'])('%s opens the exact official origin through the OS browser handler', async os => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
  try {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const renderer = await renderBanner();
    await act(async () => { await button(renderer).props.onPress(); });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://juple.co.kr');
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  }
});

it('shares the opening guard and ignores rapid touches even after the OS resolves its promise', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(5000);
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const open = jest.spyOn(Linking, 'openURL').mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const renderer = await renderBanner();
  let first!: Promise<void>;
  await act(async () => {
    first = button(renderer).props.onPress();
    await button(renderer).props.onPress();
  });
  expect(open).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(); await first; });
  await act(async () => { await button(renderer).props.onPress(); });
  expect(open).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(6000);
  await act(async () => { await button(renderer).props.onPress(); });
  expect(open).toHaveBeenCalledTimes(2);
});

it('shows the existing localized failure dialog and permits a retry without an unhandled rejection', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No browser')).mockResolvedValue(undefined);
  const renderer = await renderBanner();
  await act(async () => { await button(renderer).props.onPress(); });
  const dialog = renderer.root.findByType(ConfirmDialog);
  expect(dialog.props.visible).toBe(true);
  expect(dialog.props.message).toBe(i18n.t('customerCenter.openLinkFailed'));
  await act(async () => { dialog.props.onConfirm(); await button(renderer).props.onPress(); });
  expect(open).toHaveBeenCalledTimes(2);
  expect(renderer.root.findByType(ConfirmDialog).props.visible).toBe(false);
});

it('clips the real press feedback to the existing banner radius without changing the banner layout', async () => {
  const renderer = await renderBanner();
  const native = button(renderer);
  const bannerStyle = StyleSheet.flatten(native.props.style);
  let pressed!: ReactTestRenderer.ReactTestRenderer;
  act(() => { pressed = ReactTestRenderer.create(<View>{native.props.children({ pressed: true })}</View>); });
  const layer = pressed.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'press-feedback-layer')[0];
  expect(StyleSheet.flatten(layer.props.style)).toMatchObject({ borderRadius: bannerStyle.borderRadius, position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 });
  expect(layer.props.pointerEvents).toBe('none');
  expect(StyleSheet.flatten(native.props.style)).toEqual(bannerStyle);
});
