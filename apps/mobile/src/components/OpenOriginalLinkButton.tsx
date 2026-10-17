import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { colors, themedStyles } from '../theme/tokens';

interface OpenOriginalLinkButtonProps {
  /** Opens the saved original URL (never Item Details) - the screen owns the "could not open" message. */
  readonly onPress: () => void;
  /** 'row': the List row's end cell (a 44dp target). 'card': the Grid card's small corner button. */
  readonly variant: 'row' | 'card';
  readonly testID?: string;
}

/**
 * 바로가기: the one icon button that opens a saved link's ORIGINAL page, in List rows and Grid cards (the 9-column image view has none).
 * It is a control of its own inside the card - its press never reaches the card's own tap (which opens Item Details) - with the same
 * label Item Details' own open button and the long-press menu use. The icon is logical-direction neutral (it mirrors nothing).
 */
export function OpenOriginalLinkButton({ onPress, variant, testID = 'saved-link-open-original' }: OpenOriginalLinkButtonProps) {
  const { t } = useTranslation();
  const isRow = variant === 'row';
  return (
    <Pressable
      accessibilityLabel={t('item.goToUrlA11y')}
      accessibilityRole="button"
      hitSlop={isRow ? 4 : 6}
      onPress={event => {
        event?.stopPropagation();
        onPress();
      }}
      style={({ pressed }) => [isRow ? styles.row : styles.card, pressed && styles.pressed]}
      testID={testID}
    >
      <ExternalLinkIcon color={colors.textSecondary} size={isRow ? 20 : 16} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  // 44dp: the minimum touch target; the row's text column ends before it (it is a sibling cell, not an overlay).
  row: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  // A compact corner button: 28dp visible target + hitSlop, in the card's meta line - never over the picture or the title.
  card: { alignItems: 'center', height: 28, justifyContent: 'center', width: 28 },
  pressed: { opacity: 0.55 },
}));
