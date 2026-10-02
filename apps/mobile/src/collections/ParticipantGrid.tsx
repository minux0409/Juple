import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UserAvatar } from '../components/UserAvatar';
import { OwnerCrown } from './OwnerCrown';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/** One person as a compact tile - the same data whichever screen shows it (Share status, the participants popup). */
export interface ParticipantTileData {
  readonly key: string;
  readonly jupleId: string;
  readonly displayName?: string | null;
  readonly imageUrl?: string | null;
  readonly imageVersion?: string | null;
  /** The Collection's Owner: a crown beside the avatar. */
  readonly isOwner?: boolean;
  /** What is shown as the name (the display name, else the Juple ID - the screen decides, e.g. "(나)"). */
  readonly name: string;
  /** Role / status under the name ("링크 추가", "초대 대기"...). */
  readonly detail?: string;
  /**
   * What tapping the tile does - the very action the List row offers (manage a member, cancel an
   * invitation). Omitted for people the viewer cannot manage: the tile is then not a button at all.
   */
  readonly onPress?: () => void;
  readonly accessibilityLabel: string;
  readonly testID?: string;
}

/** Tiles per row: 3 fits a 320dp phone with a name and a role line under a 48dp avatar; the grid never grows more columns. */
export const PARTICIPANT_GRID_COLUMNS = 3;
const TILE_AVATAR_SIZE = 48;

/**
 * Participants as avatar tiles (the Grid view of both the 공유 상태 list and the participants popup -
 * one implementation for both): avatar (photo, else the initial / glyph fallback), the Owner's crown,
 * name and role on single ellipsized lines. A manageable person's tile is a button that runs the same
 * action their List row has, so Grid never loses a management function.
 */
export function ParticipantGrid({ tiles, testID }: { readonly tiles: readonly ParticipantTileData[]; readonly testID?: string }) {
  return (
    <View style={styles.grid} testID={testID}>
      {tiles.map(tile => {
        const content = (
          <>
            <View style={styles.avatarWrap}>
              <UserAvatar displayName={tile.displayName} imageUrl={tile.imageUrl} imageVersion={tile.imageVersion} jupleId={tile.jupleId} size={TILE_AVATAR_SIZE} />
              {tile.isOwner ? <View style={styles.crown}><OwnerCrown /></View> : null}
            </View>
            <Text numberOfLines={1} style={styles.name}>{tile.name}</Text>
            {tile.detail ? <Text numberOfLines={1} style={styles.detail}>{tile.detail}</Text> : null}
          </>
        );
        return (
          <View key={tile.key} style={styles.cell}>
            {tile.onPress ? (
              <Pressable
                accessibilityLabel={tile.accessibilityLabel}
                accessibilityRole="button"
                onPress={tile.onPress}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                testID={tile.testID}
              >
                {content}
              </Pressable>
            ) : (
              <View accessibilityLabel={tile.accessibilityLabel} accessible style={styles.tile} testID={tile.testID}>
                {content}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cell: { flexBasis: `${100 / PARTICIPANT_GRID_COLUMNS}%`, maxWidth: `${100 / PARTICIPANT_GRID_COLUMNS}%`, padding: spacing.xs },
  tile: { alignItems: 'center', borderRadius: radii.md, minHeight: minTouchTarget + 36, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center' },
  crown: { bottom: -4, end: -6, position: 'absolute' },
  name: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: spacing.xs, maxWidth: '100%', textAlign: 'center' },
  detail: { color: colors.textSecondary, fontSize: 11, marginTop: 1, maxWidth: '100%', textAlign: 'center' },
});
