import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PeopleIcon } from '../icons/PeopleIcon';
import { cardShadow, colors, themedStyles } from '../theme/tokens';

/**
 * How far a corner badge sits outside the picture's corner (dp), on both axes: the corner place the lock badge used to have at the
 * top-start, and the shared badge still has at the bottom-start. The selection check circle reuses it, so it straddles the same corner.
 */
export const STATUS_BADGE_CORNER_OFFSET = -4;

interface CollectionStatusBadgesProps {
  readonly isShared: boolean;
  /** Diameter of each badge - small enough never to cover the icon's own glyph. */
  readonly size?: number;
}

/**
 * Status marker overlaid on a Category icon tile: shared (공동작업) at bottom-start, straddling the corner, clear of the end-side favorite
 * star (top) and item count (bottom). Informational only - not a button. Positioned against the icon slot itself (the parent must be
 * position: relative, sized to the icon). A LOCKED Collection is not marked here any more: its padlock sits before its name
 * (CollectionNameLabel), so the picture's top-start corner is free for the selection check.
 */
export function CollectionStatusBadges({ isShared, size = 20 }: CollectionStatusBadgesProps) {
  const { t } = useTranslation();
  const badgeStyle = { borderRadius: size / 2, height: size, width: size };
  const glyph = Math.round(size * 0.62);

  return isShared ? (
    <View
      accessibilityLabel={t('collections.sharedA11y')}
      style={[styles.badge, styles.bottomStart, badgeStyle]}
      testID="collection-badge-shared"
    >
      <PeopleIcon color={colors.brandText} size={glyph} strokeWidth={2} />
    </View>
  ) : null;
}

const styles = themedStyles(() => ({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    position: 'absolute',
    // Above a selection frame / check drawn on the same icon, on every platform: the frame never covers a badge.
    zIndex: 5,
    ...cardShadow,
  },
  bottomStart: { bottom: STATUS_BADGE_CORNER_OFFSET, start: STATUS_BADGE_CORNER_OFFSET },
}));
