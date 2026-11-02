import { create, act } from 'react-test-renderer';
import { View, StyleSheet } from 'react-native';
import { menuRowPosition, menuRowShape } from '../menuRowShape';
import { SettingsMenuRow } from '../SettingsMenuRow';
import { radii } from '../../theme/tokens';

it.each([
  ['single', [16, 16, 16, 16]], ['first', [16, 16, 0, 0]],
  ['middle', [0, 0, 0, 0]], ['last', [0, 0, 16, 16]],
] as const)('%s cell gives the actual Pressable the group corners', (position, expected) => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SettingsMenuRow icon={<View />} onPress={() => {}} position={position} title="Menu" testID="row" />); });
  const row = tree.root.findAll(node => node.props.testID === 'row' && node.props.style)[0];
  const shape = StyleSheet.flatten(row.props.style);
  expect([shape.borderTopLeftRadius, shape.borderTopRightRadius, shape.borderBottomLeftRadius, shape.borderBottomRightRadius])
    .toEqual(expected.map(value => value ? radii.lg : 0));
  expect(shape.overflow).toBeUndefined();
});

it('derives first / middle / last and a one-row group without forcing all corners round', () => {
  expect([0, 1, 2].map(index => menuRowPosition(index, 3))).toEqual(['first', 'middle', 'last']);
  expect(menuRowShape(menuRowPosition(0, 1))).toEqual(menuRowShape('single'));
});
