import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { UserAvatar } from './UserAvatar';

/** The part of a participant the stack needs - what the participant list already returns. */
export interface StackedParticipant {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

interface ParticipantAvatarStackProps {
  /** null while they are still loading: small placeholder circles take their place (same size, same row). */
  readonly participants: readonly StackedParticipant[] | null;
  /** How many placeholder circles to draw while participants is null. */
  readonly placeholderCount?: number;
  /** How many circles are drawn before the rest collapse into one "+N" circle. */
  readonly maxVisible?: number;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

const AVATAR_SIZE = 28;
const RING_WIDTH = 2;
const OVERLAP = 10;
const CIRCLE_SIZE = AVATAR_SIZE + RING_WIDTH * 2;

/**
 * A compact, tappable row of small overlapping circular profile photos (a person without one shows
 * their initial - see UserAvatar), the first `maxVisible` people and a "+N" circle for everyone else.
 * The whole row is one button; the row's start edge is the first person, mirrored under RTL because
 * the overlap is a logical margin.
 */
export function ParticipantAvatarStack({
  participants,
  placeholderCount = 2,
  maxVisible = 4,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ParticipantAvatarStackProps) {
  // A single overflow circle takes the place of the last slot, never an extra one - so "+N" always
  // stands for at least two people (never one person hidden behind a number).
  const loaded = participants ?? [];
  const hasOverflow = loaded.length > maxVisible;
  const visible = hasOverflow ? loaded.slice(0, maxVisible - 1) : loaded;
  const hiddenCount = loaded.length - visible.length;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={participants === null}
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      {participants === null
        ? Array.from({ length: Math.max(1, Math.min(placeholderCount, maxVisible)) }, (_, index) => (
            <View key={index} style={[styles.ring, index > 0 && styles.overlap]} testID={`${testID ?? 'participant-stack'}-placeholder-${index}`}>
              <View style={styles.placeholder} />
            </View>
          ))
        : null}
      {visible.map((participant, index) => (
        <View key={participant.jupleId} style={[styles.ring, index > 0 && styles.overlap]} testID={`${testID ?? 'participant-stack'}-avatar-${participant.jupleId}`}>
          <UserAvatar
            displayName={participant.displayName}
            imageUrl={participant.profileImageUrl}
            imageVersion={participant.profileImageVersion}
            jupleId={participant.jupleId}
            size={AVATAR_SIZE}
          />
        </View>
      ))}
      {hasOverflow ? (
        <View style={[styles.ring, styles.overlap]}>
          <View style={styles.more}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.moreLabel} testID={`${testID ?? 'participant-stack'}-more`}>
              +{hiddenCount}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The row is a full touch target tall, though the circles are small.
  row: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    marginTop: spacing.xs,
    minHeight: minTouchTarget,
  },
  ring: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: CIRCLE_SIZE / 2,
    height: CIRCLE_SIZE,
    justifyContent: 'center',
    width: CIRCLE_SIZE,
  },
  overlap: { marginStart: -OVERLAP },
  placeholder: { backgroundColor: colors.brandSoft, borderRadius: AVATAR_SIZE / 2, height: AVATAR_SIZE, width: AVATAR_SIZE },
  more: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    justifyContent: 'center',
    width: AVATAR_SIZE,
  },
  moreLabel: { color: colors.brand, fontSize: 11, fontWeight: '700' },
});
