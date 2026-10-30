import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet } from 'react-native';
import i18n from '../../i18n';
import { iosHeaderBackOptions } from '../sheetHeader';

const originalOS = Platform.OS;

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('iosHeaderBackOptions', () => {
  it('on iOS replaces the titled system back button with the arrow alone, without the glass background, and goes back', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const goBack = jest.fn();
    const options = iosHeaderBackOptions(goBack);

    expect(options.headerBackVisible).toBe(false);
    const items = options.unstable_headerLeftItems!({ canGoBack: true, tintColor: '#123456' });
    expect(items).toHaveLength(1);
    const item = items[0];
    if (item.type !== 'custom') {
      throw new Error('expected a custom header item');
    }
    expect(item.hidesSharedBackground).toBe(true);

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(item.element);
    });
    const button = renderer.root.findByProps({ testID: 'header-back', accessibilityRole: 'button' });
    expect(button.props.accessibilityLabel).toBe(i18n.t('common.back'));
    act(() => button.props.onPress());
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('the arrow is a square control centred on the glyph (its press shows as a circle), with the glyph, layout width and touch area unchanged', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const item = iosHeaderBackOptions(jest.fn()).unstable_headerLeftItems!({ canGoBack: true })[0];
    if (item.type !== 'custom') {
      throw new Error('expected a custom header item');
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(item.element);
    });
    const button = renderer.root.findByProps({ testID: 'header-back', accessibilityRole: 'button' });
    const style = StyleSheet.flatten(button.props.style);
    expect(style.width).toBe(style.height);
    expect(style.width).toBe(44);
    // 44 wide, pulled back 10 on each side: it still takes the 24pt of the glyph in the row, and the glyph stays on the bar's inset.
    expect(style.marginStart).toBe(-10);
    expect(style.marginEnd).toBe(-10);
    // The touch area still reaches 16pt beyond the glyph on each side.
    expect(button.props.hitSlop).toEqual({ top: 10, bottom: 10, left: 6, right: 6 });
  });

  it('on iOS shows nothing on a stack\'s first screen', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    expect(iosHeaderBackOptions(jest.fn()).unstable_headerLeftItems!({ canGoBack: false })).toEqual([]);
  });

  it('on Android sets nothing (the native header arrow and system back stay as they are)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    expect(iosHeaderBackOptions(jest.fn())).toEqual({});
  });
});
