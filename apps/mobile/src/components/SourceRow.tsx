import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SiteIcon } from '../icons/SiteIcon';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, ltrTextStyle, spacing } from '../theme/tokens';

interface SourceRowProps {
  readonly url: string;
  /** e.g. the external-open icon button (ItemDetailsScreen) or an edit icon (NewLinkReviewScreen) - kept as a slot rather than a fixed prop since the two screens need different actions here. */
  readonly trailing?: ReactNode;
}

/**
 * Compact "출처" row shown in place of a raw URL string on Item Details / New Link Review - a
 * known site's icon + proper name (YouTube/Instagram/Naver, never translated), or the generic link
 * icon + bare hostname for everything else (see resolveSiteInfo.ts). The full URL is deliberately
 * never rendered here.
 */
export function SourceRow({ url, trailing }: SourceRowProps) {
  const site = resolveSiteInfo(url);

  return (
    <View style={styles.row}>
      <View style={styles.iconAndLabel}>
        <SiteIcon siteId={site.id} size={18} />
        <Text numberOfLines={1} style={[styles.label, ltrTextStyle]}>
          {site.label ?? url}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconAndLabel: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginEnd: spacing.md,
  },
  label: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
});
