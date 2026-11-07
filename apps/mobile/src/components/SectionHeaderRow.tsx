import type { ComponentType, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { TITLE_COUNT_GAP } from './savedLinkLayout';
import { colors, spacing, themedStyles } from '../theme/tokens';

type SectionHeaderIcon = ComponentType<{ readonly color?: string; readonly size?: number }>;

interface SectionHeaderRowProps {
  /** Decoration before the label (the same navigation / content icon the screen uses elsewhere). */
  readonly icon?: SectionHeaderIcon;
  readonly iconSize?: number;
  readonly iconColor?: string;
  /** Short UI label. One line; a long translation is ellipsized, never wrapped onto a second line. */
  readonly title?: string;
  /** Muted number right after the title ("최근 저장  3"). */
  readonly count?: string;
  /** The end-edge control, usually a ViewModeToggle. It keeps its natural width and is never squeezed. */
  readonly trailing?: ReactNode;
  readonly titleVariant?: 'heading' | 'caption';
  readonly testID?: string;
  readonly style?: object;
}

/**
 * One header row for a content section: "[icon] Title count" on the start side and a fixed-width control on the
 * end side, always on a single line. The label side shrinks (and ellipsizes) first, so the control and the count
 * keep their place for every translation and for RTL, where the row mirrors on its own.
 */
export function SectionHeaderRow({ icon: Icon, iconSize = 20, iconColor, title, count, trailing, titleVariant = 'heading', testID, style }: SectionHeaderRowProps) {
  const hasLabel = Icon !== undefined || title !== undefined;
  return (
    <View style={[styles.row, style]} testID={testID}>
      {hasLabel ? (
        <View style={styles.start}>
          {Icon ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
              <Icon color={iconColor ?? colors.brandText} size={iconSize} />
            </View>
          ) : null}
          {title !== undefined ? (
            <View style={styles.cluster}>
              <Text numberOfLines={1} style={[styles.title, titleVariant === 'caption' && styles.caption]}>{title}</Text>
              {count !== undefined ? <Text numberOfLines={1} style={styles.count}>{count}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : <View style={styles.spacer} />}
      {trailing !== undefined && trailing !== null ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  start: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  spacer: { flex: 1 },
  icon: { flexShrink: 0 },
  // Baseline-aligned title and count; the title shrinks, the count never does.
  cluster: { alignItems: 'baseline', columnGap: TITLE_COUNT_GAP, flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
  caption: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  count: { color: colors.textSecondary, flexShrink: 0, fontSize: 13, fontWeight: '500' },
  trailing: { flexShrink: 0 },
}));
