import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { AddIconButton } from '../AddIconButton';
import { PlusIcon } from '../../icons/PlusIcon';
import { colors, getActiveColorScheme, minTouchTarget, radii, setActiveColorScheme } from '../../theme/tokens';

it.each(['light', 'dark'] as const)('%s: shared Collection/Friend add button keeps a square filled target and a contrasting plus', scheme => {
  const previous = getActiveColorScheme();
  setActiveColorScheme(scheme);
  let tree!: ReactTestRenderer;
  try {
    const press = jest.fn();
    act(() => { tree = create(<AddIconButton accessibilityLabel="Add" onPress={press} testID="add" />); });
    const button = tree.root.findAll(node => node.props.testID === 'add' && typeof node.props.style === 'object')[0];
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ backgroundColor: colors.brand, width: minTouchTarget, height: minTouchTarget, borderRadius: radii.md + 4 });
    expect(tree.root.findByType(PlusIcon).props.color).toBe(colors.onBrand);
    expect(tree.root.findByType(PlusIcon).props.color).not.toBe(colors.brand);
    act(() => button.props.onPress());
    expect(press).toHaveBeenCalledTimes(1);
  } finally {
    act(() => tree?.unmount());
    setActiveColorScheme(previous);
  }
});
