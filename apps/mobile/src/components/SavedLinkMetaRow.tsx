import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ItemAdderDisplay } from '../collections/itemAdder';
import i18n from '../i18n';
import { SiteIcon } from '../icons/SiteIcon';
import { ItemAdderBadge } from './ItemAdderBadge';
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
  /**
   * Who added the link, inside a shared Collection (see collections/itemAdder.ts's describeItemAdder)
   * - its own second line, so the time line above never loses room to it: the adder's small avatar
   * (a crown beside it when they own the Collection), or the anonymous public-link text. The words
   * (who, and whether they are the Owner) are in its accessibility label.
   */
  readonly addedBy?: ItemAdderDisplay | null;
}

/**
 * The one secondary "saved time + platform icon" line shared by List rows (SavedLinkRow) and Grid
 * cards (SavedLinkGridCard), so both presentations of the same Item always show the same timestamp,
 * formatting and icon (dedicated site icon, generic globe otherwise) - never a hostname/site name.
 * Single line: the time text shrinks with an ellipsis before the icon is ever pushed out.
 */
/** The adder avatar's diameter - the height of the 12pt text line it replaces, so cards keep their height. */
const ADDER_AVATAR_SIZE = 16;

export function SavedLinkMetaRow({ savedAtUtc, url, dateDisplayMode, style, addedBy }: SavedLinkMetaRowProps) {
  const timeRow = (
    <View style={[styles.metaRow, addedBy ? null : style]}>
      <Text numberOfLines={1} style={styles.time}>
        {formatSavedLinkTimestamp(savedAtUtc, dateDisplayMode)}
      </Text>
      <View style={styles.icon}>
        <SiteIcon siteId={resolveSiteInfo(url).id} size={15} />
      </View>
    </View>
  );
  if (!addedBy) {
    return timeRow;
  }
  return (
    <View style={style}>
      {timeRow}
      <ItemAdderBadge adder={addedBy} avatarSize={ADDER_AVATAR_SIZE} style={styles.adderRow} />
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
  adderRow: {
    marginTop: 2,
  },
});
