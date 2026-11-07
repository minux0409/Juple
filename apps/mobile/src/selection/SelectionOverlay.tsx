import { StyleSheet, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { radii, themedStyles } from '../theme/tokens';
import { STATUS_BADGE_CORNER_OFFSET } from '../collections/CollectionStatusBadges';
import { SelectionCheckMark } from './SelectionCheckMark';

interface SelectionOverlayProps {
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly accessibilityLabel?: string;
  readonly borderRadius?: number;
  /**
   * Where the check mark sits relative to the card's top-start corner. Default: inside the corner (links cards). A NEGATIVE value puts the
   * mark's center-ish on the corner so it straddles the frame (Collections), the same for chosen and not-chosen cards.
   */
  readonly markOffset?: number;
  readonly testID?: string;
}

/**
 * A card's selection layer: an invisible full-card checkbox above the card's own content (so its press, star and other controls cannot
 * react while selecting), the check mark in the corner, and a frame + soft tint when chosen. Put it last inside a card whose
 * container is `position: relative` (the default); the card's own layout is not changed.
 */
export function SelectionOverlay({ selected, onToggle, accessibilityLabel, borderRadius = radii.lg, markOffset, testID }: SelectionOverlayProps) {
  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={onToggle}
        pressFeedback={false}
        style={[styles.layer, { borderRadius }, selected && styles.layerSelected]}
        testID={testID ?? 'selection-overlay'}
      />
      <SelectionCheckMark selected={selected} style={markOffset === undefined ? undefined : { start: markOffset, top: markOffset }} />
    </>
  );
}

const styles = themedStyles(() => ({
  layer: { ...StyleSheet.absoluteFill, zIndex: 2 },
  layerSelected: { backgroundColor: 'rgba(90,68,238,0.10)', borderColor: 'rgba(90,68,238,0.9)', borderWidth: 2 },
}));

/** An invisible checkbox over a whole card: a tap anywhere on it (image or name) chooses / un-chooses, and nothing under it reacts. */
export function SelectionTouchLayer({ selected, onToggle, accessibilityLabel, testID }: { readonly selected: boolean; readonly onToggle: () => void; readonly accessibilityLabel?: string; readonly testID?: string }) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, selected }}
      onPress={onToggle}
      pressFeedback={false}
      style={touchStyles.layer}
      testID={testID ?? 'selection-overlay'}
    />
  );
}

interface SelectionImageFrameProps {
  readonly selected: boolean;
  /** The picture's own corner radius, so the frame follows its shape. */
  readonly borderRadius: number;
  /** The check circle's diameter (the status badges' size on that picture) and its offset from the picture's top-start corner - by default the corner place the lock badge used to occupy, so it straddles the corner. */
  readonly markSize?: number;
  readonly markInset?: number;
}

/**
 * Selection drawn on the PICTURE only (a Collection's icon): a thin brand border and a soft tint when chosen, and - chosen or not, at
 * the same place - the check circle on the picture's top-start corner, half out of it, exactly where the lock badge used to sit (grey and empty, or
 * brand-coloured with a white check). That corner is free of other markers (the padlock of a locked Collection sits before its name). No touch area of its own: purely visual
 * (`pointerEvents="none"`, exactly the picture's box). Taps are caught by a SelectionTouchLayer over the whole card, which carries the
 * checkbox role and the chosen state for assistive technology.
 */
export function SelectionImageFrame({ selected, borderRadius, markSize = 20, markInset = STATUS_BADGE_CORNER_OFFSET }: SelectionImageFrameProps) {
  return (
    <>
      <View pointerEvents="none" style={[touchStyles.frame, { borderRadius }, selected && touchStyles.frameSelected]} testID="selection-image-frame" />
      <SelectionCheckMark selected={selected} size={markSize} style={{ start: markInset, top: markInset }} testID="selection-image-mark" />
    </>
  );
}

const touchStyles = themedStyles(() => ({
  layer: { ...StyleSheet.absoluteFill, zIndex: 2 },
  frame: { ...StyleSheet.absoluteFill, zIndex: 1 },
  frameSelected: { backgroundColor: 'rgba(90,68,238,0.22)', borderColor: 'rgba(90,68,238,0.95)', borderWidth: 1.5 },
}));
