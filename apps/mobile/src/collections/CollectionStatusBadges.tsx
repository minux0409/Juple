import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { cardShadow, colors } from '../theme/tokens';

interface CollectionStatusBadgesProps {
  readonly isLocked: boolean;
  readonly isShared: boolean;
  /** Diameter of each badge - small enough never to cover the icon's own glyph. */
  readonly size?: number;
}

/**
 * Status markers overlaid on a Category icon tile, on the start side so they never collide with the
 * existing end-side favorite star (top) and item count (bottom): lock at top-start, shared (공동작업)
 * at bottom-start, both at once when both apply. Informational only - not buttons. Positioned
 * against the icon slot itself (the parent must be position: relative, sized to the icon).
 */
export function CollectionStatusBadges({ isLocked, isShared, size = 20 }: CollectionStatusBadgesProps) {
  const { t } = useTranslation();
  const badgeStyle = { borderRadius: size / 2, height: size, width: size };
  const glyph = Math.round(size * 0.62);

  return (
    <>
      {isLocked ? (
        <View
          accessibilityLabel={t('collections.lockedA11y')}
          style={[styles.badge, styles.topStart, badgeStyle]}
          testID="collection-badge-locked"
        >
          <LockIcon color={colors.textPrimary} size={glyph} strokeWidth={2} />
        </View>
      ) : null}
      {isShared ? (
        <View
          accessibilityLabel={t('collections.sharedA11y')}
          style={[styles.badge, styles.bottomStart, badgeStyle]}
          testID="collection-badge-shared"
        >
          <PeopleIcon color={colors.brand} size={glyph} strokeWidth={2} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    position: 'absolute',
    ...cardShadow,
  },
  topStart: { start: -4, top: -4 },
  bottomStart: { bottom: -4, start: -4 },
});
