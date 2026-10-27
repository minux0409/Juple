import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SearchIconButton } from '../SearchIconButton';
import { SearchIcon } from '../../icons/SearchIcon';
import { colors } from '../../theme/tokens';

function render(props: { disabled?: boolean; isLoading?: boolean }, onPress = jest.fn()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<SearchIconButton accessibilityLabel="찾기" onPress={onPress} testID="find" {...props} />);
  });
  // The Pressable itself: the node carrying the button's state as a style function of `pressed`.
  const pressable = renderer.root.findAll(node => node.props.testID === 'find' && typeof node.props.style === 'function')[0];
  const style = (pressed = false) => StyleSheet.flatten(pressable.props.style({ pressed }));
  return { renderer, pressable, style };
}

describe('SearchIconButton - its state is in its colours', () => {
  it('nothing to look up yet: a quiet neutral square with a light icon - not a faded copy of the active look', () => {
    const { renderer, pressable, style } = render({ disabled: true });
    expect(pressable.props.disabled).toBe(true);
    expect(style()).toEqual(expect.objectContaining({ backgroundColor: colors.surfaceMuted, borderColor: colors.inputBorder }));
    expect(style().opacity).toBeUndefined();
    expect(renderer.root.findByType(SearchIcon).props.color).toBe(colors.placeholder);
  });

  it('ready: the brand fill with the icon on it, and a pressed feedback while held', () => {
    const onPress = jest.fn();
    const { renderer, pressable, style } = render({}, onPress);
    expect(pressable.props.disabled).toBe(false);
    expect(style()).toEqual(expect.objectContaining({ backgroundColor: colors.brand, borderColor: colors.brand }));
    expect(renderer.root.findByType(SearchIcon).props.color).toBe(colors.onBrand);
    expect(style(true).opacity).toBeLessThan(1);
    act(() => pressable.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('looking up: the brand square with a spinner, and it cannot start a second lookup', () => {
    const { renderer, pressable, style } = render({ isLoading: true });
    expect(pressable.props.disabled).toBe(true);
    expect(pressable.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(style().backgroundColor).toBe(colors.brand);
    expect(renderer.root.findByType(ActivityIndicator).props.color).toBe(colors.onBrand);
    expect(renderer.root.findAllByType(SearchIcon)).toHaveLength(0);
  });
});
