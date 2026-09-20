import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import i18n from '../i18n';
import { SiteIcon } from '../icons/SiteIcon';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnailUrl } from '../items/resolveEffectiveThumbnailUrl';
import { resolveSavedLinkPrimaryText } from '../items/savedLinkPrimaryText';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
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
  /**
   * When true, the thumbnail uses the full cover/preview/first-image priority (see
   * resolveEffectiveThumbnailUrl) instead of only the first-uploaded image. Opt-in and defaults to
   * false so History (DateHistoryScreen) keeps its existing thumbnail behavior unchanged - only
   * Home (DailyInboxScreen) passes true. This is intentionally a minimal presentation flag rather
   * than a History redesign.
   */
  readonly preferEffectiveThumbnail?: boolean;
}

/**
 * Shared saved-link row content for Home and History (see DailyInboxScreen/DateHistoryScreen) -
 * both screens show the exact same item shape, so this is the one place that decides what's
 * primary vs secondary rather than each screen repeating its own (previously diverging) layout.
 *
 * Visual hierarchy, brightest/largest to most muted: title (or a domain fallback when there's no
 * title) -> memo, when present -> saved time + a small site icon. The raw URL is deliberately never
 * shown on this row at all (see SiteIcon.tsx/resolveSiteInfo.ts) - only savedLinkPrimaryText's own
 * hostname fallback ever surfaces as text, and only when there's no title.
 */
export function SavedLinkRow({
  item,
  isActionInFlight,
  dateDisplayMode = 'time',
  preferEffectiveThumbnail = false,
}: SavedLinkRowProps) {
  const primaryText = resolveSavedLinkPrimaryText(item.title, item.url);
  const thumbnailUrl = preferEffectiveThumbnail
    ? resolveEffectiveThumbnailUrl(item)
    : item.representativeImage?.readUrl ?? null;
  const siteId = resolveSiteInfo(item.url).id;

  return (
    <View style={styles.row}>
      <View style={styles.thumbnailWrapper}>
        <ItemRepresentativeThumbnail imageUrl={thumbnailUrl} />
        {isActionInFlight ? (
          <View style={styles.thumbnailOverlay}>
            <ActivityIndicator color={colors.surface} size="small" />
          </View>
        ) : null}
      </View>
      <View style={styles.textColumn}>
        {/* primaryText is the user's own title (any language/direction - never forced) when one
            exists, otherwise a hostname fallback (see savedLinkPrimaryText.ts) - only that fallback
            case is a technical identifier that needs LTR isolation so it never gets visually
            reordered inside an RTL row. */}
        <Text
          numberOfLines={2}
          style={[styles.primaryText, !item.title && ltrTextStyle]}
        >
          {primaryText}
        </Text>
        {item.memo ? (
          <Text numberOfLines={1} style={styles.memo}>
            {item.memo}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.time}>
            {dateDisplayMode === 'dateTime' ? formatSavedDateTime(item.savedAtUtc) : formatSavedTime(item.savedAtUtc)}
          </Text>
          <SiteIcon siteId={siteId} size={15} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
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
  },
  primaryText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  memo: {
    color: colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 2,
  },
  // Time + site icon sit together as one compact unit (not stretched across the row) - matches the
  // mockup's "오후 2:17 [icon]" grouping directly under the title.
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 6,
  },
  time: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
});
