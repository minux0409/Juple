import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ItemRepresentativeThumbnail } from '../images/ItemRepresentativeThumbnail';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnailUrl } from '../items/resolveEffectiveThumbnailUrl';
import { useTranslation } from 'react-i18next';
import { resolveSavedLinkDisplayTitle } from '../items/savedLinkPrimaryText';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';
import { MoreIcon } from '../icons/MoreIcon';
import { SavedLinkMetaRow, type SavedLinkDateDisplayMode } from './SavedLinkMetaRow';

interface SavedLinkRowProps {
  readonly item: ItemHistoryEntry;
  readonly isActionInFlight: boolean;
  /** 'time' (default) or 'dateTime' - see SavedLinkDateDisplayMode. */
  readonly dateDisplayMode?: SavedLinkDateDisplayMode;
  /**
   * When true, the thumbnail uses the full cover/preview/first-image priority (see
   * resolveEffectiveThumbnailUrl) instead of only the first-uploaded image. Opt-in and defaults to
   * false so History (DateHistoryScreen) keeps its existing thumbnail behavior unchanged - only
   * Home (DailyInboxScreen) passes true. This is intentionally a minimal presentation flag rather
   * than a History redesign.
   */
  readonly preferEffectiveThumbnail?: boolean;
  readonly trailingAction?: { readonly accessibilityLabel: string; readonly onPress: () => void };
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
  trailingAction,
}: SavedLinkRowProps) {
  const { t } = useTranslation();
  const primaryText = resolveSavedLinkDisplayTitle(item.title, item.url, t);
  const thumbnailUrl = preferEffectiveThumbnail
    ? resolveEffectiveThumbnailUrl(item)
    : item.representativeImage?.readUrl ?? null;

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
            exists, otherwise a localized content label or hostname fallback (see
            savedLinkPrimaryText.ts) - only the hostname case is a technical identifier that needs
            LTR isolation so it never gets visually reordered inside an RTL row. */}
        <Text
          numberOfLines={2}
          style={[styles.primaryText, primaryText.isTechnicalIdentifier && ltrTextStyle]}
        >
          {primaryText.text}
        </Text>
        {item.memo ? (
          <Text numberOfLines={1} style={styles.memo}>
            {item.memo}
          </Text>
        ) : null}
        <SavedLinkMetaRow dateDisplayMode={dateDisplayMode} savedAtUtc={item.savedAtUtc} style={styles.metaRow} url={item.url} />
      </View>
      {trailingAction ? <Pressable accessibilityLabel={trailingAction.accessibilityLabel} accessibilityRole="button" hitSlop={8} onPress={event => { event?.stopPropagation(); trailingAction.onPress(); }} style={styles.trailingAction}><MoreIcon color={colors.textSecondary} size={20} /></Pressable> : null}
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
  // Outer spacing only - the time + site icon content rules live in SavedLinkMetaRow (shared with Grid).
  metaRow: {
    marginTop: 6,
  },
  trailingAction: { paddingStart: spacing.sm, paddingVertical: spacing.sm },
});
