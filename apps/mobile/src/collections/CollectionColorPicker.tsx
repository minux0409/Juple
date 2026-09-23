import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutChangeEvent, Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { customColorFromHue, hueFromCustomColor, isCustomCollectionColor, resolveCollectionColorKey, resolveCollectionColorTile, type CollectionColorKey, type CollectionColorValue } from './collectionColors';
import { colors, spacing } from '../theme/tokens';

interface CollectionColorPickerProps { readonly selected: CollectionColorValue; readonly onSelect: (color: CollectionColorValue) => void; readonly disabled?: boolean; }
const PRESET_KEYS: readonly CollectionColorKey[] = ['Blue', 'Mint', 'Rose', 'Amber', 'Purple', 'Peach', 'Teal', 'Slate'];
const HUE_STEPS = Array.from({ length: 24 }, (_, index) => index * 15);

/**
 * Preset shortcuts plus a touch/drag hue rail. Custom values are persisted as #RRGGBB.
 *
 * The hue rail's drag position used to be computed from each touch event's own `locationX` - X
 * relative to whatever native view the OS reports as that event's own touch target, which is NOT
 * guaranteed to stay the bar itself for every single move event of one continuous drag (a
 * real-device report: the selected hue visibly jumped around while dragging left/right, making it
 * very hard to land on an intended color). Fixed by measuring the bar's own absolute on-screen
 * left edge once - on layout, and again at gesture start - and computing the hue purely from
 * `pageX - barPageLeft` on every move: `pageX` is always the raw absolute touch position on
 * screen, so this stays correct no matter which view the OS attributes a given move event to.
 * Layout is deliberately measured only twice per gesture (layout + grant), never on every move -
 * re-measuring per move is exactly the kind of per-frame layout thrash that itself causes
 * position jumps, not just a performance concern.
 *
 * onResponderTerminationRequest always refuses: once this bar has gesture ownership, the
 * surrounding ScrollView (CategoryEditorDialog's own content scroll) or anything else must never
 * be able to steal it mid-drag - another concrete cause a jumpy drag can have on Android.
 */
export function CollectionColorPicker({ selected, onSelect, disabled }: CollectionColorPickerProps) {
  const { t } = useTranslation();
  const [barWidth, setBarWidth] = useState(1);
  const hueBarRef = useRef<ViewInstance>(null);
  const barPageLeftRef = useRef(0);
  const preset = resolveCollectionColorKey(selected);
  const hue = isCustomCollectionColor(selected) ? hueFromCustomColor(selected) : null;

  const selectAtPageX = (pageX: number) => {
    const relativeX = pageX - barPageLeftRef.current;
    onSelect(customColorFromHue(Math.max(0, Math.min(1, relativeX / barWidth)) * 360));
  };

  const measureBar = () => {
    hueBarRef.current?.measureInWindow((x: number) => {
      barPageLeftRef.current = x;
    });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setBarWidth(Math.max(1, event.nativeEvent.layout.width));
    measureBar();
  };

  return <View>
    <View style={styles.presetRow}>{PRESET_KEYS.map(color => {
      const tile = resolveCollectionColorTile(color); const isSelected = preset === color;
      return <Pressable accessibilityLabel={t('collections.colorOptionA11y', { color: t(`collections.colorNames.${color}`, { defaultValue: color }) })} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled), selected: isSelected }} disabled={disabled} hitSlop={6} key={color} onPress={() => onSelect(color)} style={[styles.swatch, { backgroundColor: tile.icon }, isSelected && styles.selected, disabled && styles.disabled]} testID={`collection-color-option-${color}`} />;
    })}</View>
    <View
      accessibilityLabel="Custom color hue"
      accessibilityRole="adjustable"
      onLayout={onLayout}
      onMoveShouldSetResponder={() => !disabled}
      onResponderGrant={event => { measureBar(); selectAtPageX(event.nativeEvent.pageX); }}
      onResponderMove={event => selectAtPageX(event.nativeEvent.pageX)}
      onResponderTerminationRequest={() => false}
      onStartShouldSetResponder={() => !disabled}
      ref={hueBarRef}
      style={[styles.hueBar, disabled && styles.disabled]}
      testID="collection-color-hue-bar"
    >
      {HUE_STEPS.map(hueStep => <View key={hueStep} style={{ backgroundColor: `hsl(${hueStep}, 72%, 56%)`, flex: 1 }} />)}
      {hue !== null ? <View pointerEvents="none" style={[styles.thumb, { left: `${(hue / 360) * 100}%` }]} testID="collection-color-hue-thumb" /> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  presetRow: { flexDirection: 'row', justifyContent: 'space-between' }, swatch: { borderRadius: 15, height: 30, width: 30 }, selected: { borderColor: colors.brand, borderWidth: 3 }, disabled: { opacity: 0.5 },
  hueBar: { borderRadius: 9, flexDirection: 'row', height: 18, marginTop: spacing.md, overflow: 'hidden', position: 'relative' }, thumb: { backgroundColor: colors.surface, borderColor: colors.textPrimary, borderRadius: 12, borderWidth: 2, height: 24, marginLeft: -12, position: 'absolute', top: -3, width: 24 },
});
