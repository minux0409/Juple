import type { ViewStyle } from 'react-native';
import { radii } from '../theme/tokens';

export type MenuRowPosition = 'single' | 'first' | 'middle' | 'last';

/** Radius belongs to the cell, so Pressable's state layer follows it without clipping the card's shadow. */
export function menuRowShape(position: MenuRowPosition): ViewStyle {
  return {
    borderTopLeftRadius: position === 'first' || position === 'single' ? radii.lg : 0,
    borderTopRightRadius: position === 'first' || position === 'single' ? radii.lg : 0,
    borderBottomLeftRadius: position === 'last' || position === 'single' ? radii.lg : 0,
    borderBottomRightRadius: position === 'last' || position === 'single' ? radii.lg : 0,
  };
}

export function menuRowPosition(index: number, count: number): MenuRowPosition {
  return count === 1 ? 'single' : index === 0 ? 'first' : index === count - 1 ? 'last' : 'middle';
}
