import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ItemAdderDisplay } from '../collections/itemAdder';
import { CrownIcon } from '../icons/CrownIcon';
import { UserIcon } from '../icons/UserIcon';
import { colors, spacing } from '../theme/tokens';
import { UserAvatar } from './UserAvatar';

/**
 * Who added a link to a shared Collection, drawn the same everywhere (List row, Grid tile, the
 * shared link's detail): the adder's avatar - their photo, else the fallback - with the crown beside
 * it when they own the Collection; no nickname or 소유자 text. Someone who added through the public
 * link stays anonymous: just that fact, in words. One accessible element whose label says it all
 * in words (who, and that they own the Collection).
 */
export function ItemAdderBadge({
  adder,
  avatarSize,
  style,
  testID = 'saved-link-added-by',
}: {
  readonly adder: ItemAdderDisplay;
  readonly avatarSize: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}) {
  const glyphSize = Math.round(avatarSize * 0.75);
  return (
    <View accessibilityLabel={adder.accessibilityLabel} accessible style={[styles.row, style]} testID={testID}>
      {adder.kind === 'publicLink' ? (
        <>
          <UserIcon color={colors.textSecondary} size={glyphSize} strokeWidth={2} />
          <Text numberOfLines={1} style={[styles.publicLink, { fontSize: glyphSize }]}>
            {adder.label}
          </Text>
        </>
      ) : (
        <>
          {adder.jupleId ? (
            <UserAvatar
              displayName={adder.displayName}
              imageUrl={adder.imageUrl}
              imageVersion={adder.imageVersion}
              jupleId={adder.jupleId}
              size={avatarSize}
            />
          ) : (
            <UserIcon color={colors.textSecondary} size={glyphSize} strokeWidth={2} />
          )}
          {adder.isCollectionOwner ? (
            <View testID="saved-link-adder-owner">
              <CrownIcon color={colors.warning} size={glyphSize} strokeWidth={2} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  publicLink: { color: colors.textSecondary, flexShrink: 1, fontWeight: '600' },
});
