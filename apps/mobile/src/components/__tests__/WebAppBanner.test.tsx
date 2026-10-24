import ReactTestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text, StyleSheet } from 'react-native';
import { WebAppBanner } from '../WebAppBanner';
import i18n from '../../i18n';
import { lightColors, darkColors, setActiveColorScheme } from '../../theme/tokens';

it('introduces the web app without a CTA, link or press handler', async () => {
  await i18n.changeLanguage('ko');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<WebAppBanner />); });
  const text = renderer.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Juple은 웹에서도 이용할 수 있어요');
  expect(text).toContain('PC에서도 저장한 링크와 컬렉션을 편리하게 관리해 보세요.');
  expect(text).toContain('juple.co.kr');
  expect(renderer.root.findAll(node => node.props.testID === 'web-banner-official-logo').length).toBeGreaterThan(0);
  expect(renderer.root.findAllByType(Pressable)).toHaveLength(0);
  expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
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
    expect(StyleSheet.flatten(domain.props.style).color).toBe(palette.brand);
    expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
    await act(async () => renderer.unmount());
  } finally { setActiveColorScheme('light'); }
});
