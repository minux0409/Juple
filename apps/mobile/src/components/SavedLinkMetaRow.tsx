import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ItemAdderDisplay } from '../collections/itemAdder';
import i18n from '../i18n';
import { SiteIcon } from '../icons/SiteIcon';
import { ItemAdderBadge } from './ItemAdderBadge';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, spacing, themedStyles } from '../theme/tokens';

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
  /**
   * Shown on the adder's line, at its end side (a shared link's reaction chips): the same row as
   * the avatar, never a row of its own. Only drawn together with `addedBy` - a caller without an
   * adder places such content itself.
   */
  readonly adderTrailing?: ReactNode;
  /** False: no site icon - for a locked link, whose site must not show (see SavedLinkRow / SavedLinkGridCard). */
  readonly showSiteIcon?: boolean;
  /**
   * Draw the time text too. Off by default: a saved link's time belongs to Item Details, and the date sections above a list already
   * group by day. Only a list whose time means something else (Trash: when it was deleted) turns it on.
   */
  readonly showTime?: boolean;
  /** The card's 바로가기 button: the END of the first line (never beside the reactions). */
  readonly trailingAction?: ReactNode;
}

/**
 * The one secondary "platform icon" line shared by List rows (SavedLinkRow) and Grid cards
 * (SavedLinkGridCard), so both presentations of the same Item always show the same icon (dedicated
 * site icon, generic globe otherwise) - never a hostname/site name, and no saved time (see `showTime`).
 * Single line: an optional time text shrinks with an ellipsis before the icon is ever pushed out.
 */
/** The adder avatar's diameter - the height of the 12pt text line it replaces, so cards keep their height. */
const ADDER_AVATAR_SIZE = 16;

export function SavedLinkMetaRow({ savedAtUtc, url, dateDisplayMode, style, addedBy, adderTrailing, trailingAction, showSiteIcon = true, showTime = false }: SavedLinkMetaRowProps) {
  const hasReactions = Boolean(addedBy && adderTrailing);
  // LINE 1: [service icon] [adder avatar] ............ [바로가기]. The avatar sits right beside the platform icon and the card's open button
  // ends the same line; a long anonymous-link text shrinks instead of wrapping.
  const metaRow = showTime || showSiteIcon || addedBy || trailingAction ? (
    <View style={[styles.metaRow, hasReactions ? null : style]}>
      {showTime ? (
        <Text numberOfLines={1} style={styles.time}>
          {formatSavedLinkTimestamp(savedAtUtc, dateDisplayMode)}
        </Text>
      ) : null}
      {showSiteIcon ? (
        <View style={styles.icon}>
          <SiteIcon siteId={resolveSiteInfo(url).id} size={15} />
        </View>
      ) : null}
      {addedBy ? <ItemAdderBadge adder={addedBy} avatarSize={ADDER_AVATAR_SIZE} style={styles.adderBadge} /> : null}
      {trailingAction ? <View style={styles.trailingAction}>{trailingAction}</View> : null}
    </View>
  ) : null;
  if (!hasReactions) {
    return metaRow;
  }
  // LINE 2 (only while there are reactions): the chips, on a row of their own so nothing on line 1 can clip them; several kinds wrap.
  return (
    <View style={style}>
      {metaRow}
      <View style={styles.reactionsLine}>{adderTrailing}</View>
    </View>
  );
}

const styles = themedStyles(() => ({
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
  adderBadge: {
    // The avatar keeps its size; a long anonymous-link text shrinks and ellipsizes instead.
    flexShrink: 1,
    minWidth: 0,
  },
  trailingAction: { flexShrink: 0, marginStart: 'auto' },
  // The reaction chips' own line: start-aligned, full width, wrapping (see ReactionChips, not inline).
  reactionsLine: { alignItems: 'flex-start', minWidth: 0 },
}));
