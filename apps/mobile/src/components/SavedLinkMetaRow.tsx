import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import i18n from '../i18n';
import { SiteIcon } from '../icons/SiteIcon';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, spacing } from '../theme/tokens';

/**
 * 'time' shows only the time-of-day - correct when the surrounding section is exactly one calendar
 * day (오늘/어제). 'dateTime' shows the full date too, for a section that spans multiple days (이번 주
 * / a month bucket - see historyDateGrouping.ts's showItemDate) or a Category's arbitrary dates.
 */
export type SavedLinkDateDisplayMode = 'time' | 'dateTime';

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

export function formatSavedLinkTimestamp(savedAtUtc: string, mode: SavedLinkDateDisplayMode): string {
  return mode === 'dateTime' ? formatSavedDateTime(savedAtUtc) : formatSavedTime(savedAtUtc);
}

interface SavedLinkMetaRowProps {
  readonly savedAtUtc: string;
  readonly url: string;
  readonly dateDisplayMode: SavedLinkDateDisplayMode;
  /** Outer spacing only (each container decides its own gap above this row) - never the row's own content rules. */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The one secondary "saved time + platform icon" line shared by List rows (SavedLinkRow) and Grid
 * cards (SavedLinkGridCard), so both presentations of the same Item always show the same timestamp,
 * formatting and icon (dedicated site icon, generic globe otherwise) - never a hostname/site name.
 * Single line: the time text shrinks with an ellipsis before the icon is ever pushed out.
 */
export function SavedLinkMetaRow({ savedAtUtc, url, dateDisplayMode, style }: SavedLinkMetaRowProps) {
  return (
    <View style={[styles.metaRow, style]}>
      <Text numberOfLines={1} style={styles.time}>
        {formatSavedLinkTimestamp(savedAtUtc, dateDisplayMode)}
      </Text>
      <View style={styles.icon}>
        <SiteIcon siteId={resolveSiteInfo(url).id} size={15} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  time: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
  },
  icon: {
    flexShrink: 0,
  },
});
