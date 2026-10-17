import { StyleSheet, View } from 'react-native';
import { CrownIcon } from '../icons/CrownIcon';
import { colors } from '../theme/tokens';

/** The crown glyph is this fraction of the avatar, never smaller than MIN_GLYPH (a 16dp meta avatar still gets a legible crown). */
const GLYPH_RATIO = 0.42;
const MIN_GLYPH = 10;

/**
 * The Owner (방장) marker of a SHARED Collection: a small vector crown (never an emoji, whose glyph differs per platform) on the
 * top end corner of that person's avatar, on a surface-coloured chip so it reads over a photo. Place it inside the avatar's own
 * wrapper (a View is its own positioning context); the corner is logical (`end`), so it mirrors under RTL. Decorative only - the
 * role line / accessibility label of the surrounding row already says 소유자 in words. Personal Collections have no Owner marker at all.
 */
export function OwnerCrown({ avatarSize = 32, testID = 'participant-owner-crown' }: { readonly avatarSize?: number; readonly testID?: string }) {
  const glyph = Math.max(MIN_GLYPH, Math.round(avatarSize * GLYPH_RATIO));
  const chip = glyph + 4;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.chip, { borderRadius: chip / 2, end: -Math.round(chip / 3), height: chip, top: -Math.round(chip / 3), width: chip }]}
      testID={testID}
    >
      <CrownIcon color={colors.warning} size={glyph} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', backgroundColor: colors.surface, justifyContent: 'center', position: 'absolute' },
});
