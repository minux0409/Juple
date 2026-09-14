import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import i18n from '../i18n';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveSavedLinkPrimaryText } from '../items/savedLinkPrimaryText';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';

function formatSavedTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(savedAtUtc));
}

/** Full date + time, for a row shown inside a section that spans more than one calendar day. */
function formatSavedDateTime(savedAtUtc: string): string {
  return new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(savedAtUtc));
}

interface SavedLinkRowProps {
  readonly item: ItemHistoryEntry;
  readonly isActionInFlight: boolean;
  /**
   * 'time' (default) shows only the time-of-day - correct when the surrounding section is exactly
   * one calendar day (오늘/어제). 'dateTime' shows the full date too, for a section that spans
   * multiple days (이번 주 / a month bucket - see historyDateGrouping.ts's showItemDate).
   */
  readonly dateDisplayMode?: 'time' | 'dateTime';
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
export function SavedLinkRow({ item, isActionInFlight, dateDisplayMode = 'time' }: SavedLinkRowProps) {
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
        {/* primaryText is the user's own title (any language/direction - never forced) when one
            exists, otherwise a hostname/URL fallback (see savedLinkPrimaryText.ts) - only that
            fallback case is a technical identifier that needs LTR isolation so it never gets
            visually reordered inside an RTL row. secondaryUrl below is always a raw URL. */}
        <Text
          numberOfLines={2}
          style={[styles.primaryText, !item.title && ltrTextStyle]}
        >
          {primaryText}
        </Text>
        <Text numberOfLines={1} style={[styles.secondaryUrl, ltrTextStyle]}>
          {item.url}
        </Text>
        {item.memo ? (
          <Text numberOfLines={2} style={styles.memo}>
            {item.memo}
          </Text>
        ) : null}
        <Text style={styles.time}>
          {dateDisplayMode === 'dateTime' ? formatSavedDateTime(item.savedAtUtc) : formatSavedTime(item.savedAtUtc)}
        </Text>
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
