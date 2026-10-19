import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform } from 'react-native';
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

  it('on iOS shows nothing on a stack\'s first screen', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    expect(iosHeaderBackOptions(jest.fn()).unstable_headerLeftItems!({ canGoBack: false })).toEqual([]);
  });

  it('on Android sets nothing (the native header arrow and system back stay as they are)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

    expect(iosHeaderBackOptions(jest.fn())).toEqual({});
  });
});
