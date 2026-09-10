import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import i18n from '../i18n';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveSavedLinkPrimaryText } from '../items/savedLinkPrimaryText';
import { colors, radii, spacing } from '../theme/tokens';

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

interface SavedLinkRowProps {
  readonly item: ItemHistoryEntry;
  readonly isActionInFlight: boolean;
}

/**
 * Shared saved-link row content for Home and History (see DailyInboxScreen/DateHistoryScreen) -
 * both screens show the exact same item shape, so this is the one place that decides what's
 * primary vs secondary rather than each screen repeating its own (previously diverging) layout.
 *
 * Visual hierarchy, brightest/largest to most muted: title (or a domain fallback when there's no
 * title) -> the actual URL -> memo, when present -> saved time. The raw URL deliberately never
 * becomes the biggest/darkest text on the row - see savedLinkPrimaryText.ts for the fallback rule.
 */
export function SavedLinkRow({ item, isActionInFlight }: SavedLinkRowProps) {
  const primaryText = resolveSavedLinkPrimaryText(item.title, item.url);

  return (
    <View style={styles.row}>
      <View style={styles.thumbnailWrapper}>
        <ItemRepresentativeThumbnail representativeImage={item.representativeImage} />
        {isActionInFlight ? (
          <View style={styles.thumbnailOverlay}>
            <ActivityIndicator color={colors.surface} size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.textColumn}>
        <Text numberOfLines={2} style={styles.primaryText}>
          {primaryText}
        </Text>
        <Text numberOfLines={1} style={styles.secondaryUrl}>
          {item.url}
        </Text>
        {item.memo ? (
          <Text numberOfLines={2} style={styles.memo}>
            {item.memo}
          </Text>
        ) : null}
        <Text style={styles.time}>{formatSavedTime(item.savedAtUtc)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnailOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    borderRadius: radii.md,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  textColumn: {
    flex: 1,
    marginStart: spacing.sm,
  },
  primaryText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryUrl: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  memo: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  time: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
