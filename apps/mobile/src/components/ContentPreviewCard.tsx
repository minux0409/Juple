import type { ReactNode } from 'react';
import { Image, StyleSheet, TextInput, View } from 'react-native';
import { cardShadow, colors, radii, spacing } from '../theme/tokens';

interface ContentPreviewCardProps {
  readonly previewImageUrl: string | null;
  readonly titleValue: string;
  readonly titlePlaceholder: string;
  readonly titleAccessibilityLabel?: string;
  readonly onChangeTitle: (value: string) => void;
  readonly titleEditable?: boolean;
  /** Rendered directly under the title field, above the divider - e.g. NewLinkReviewScreen's metadata-resolution-failed hint. */
  readonly titleHint?: ReactNode;
  /** Rendered below the divider - each screen's own source row / URL editing / safety status, since that part's behavior genuinely differs between screens. */
  readonly children: ReactNode;
}

/**
 * The unified "content preview" card shared by NewLinkReviewScreen (저장 전) and ItemDetailsScreen
 * (저장 후) - a representative image (when one exists) on top, an editable title, a divider, then
 * each screen's own source row - so both screens read as "the same screen at two different points
 * in one Item's lifecycle" instead of two differently structured forms. Only the visual structure
 * is shared; each screen keeps its own state/save logic entirely.
 */
export function ContentPreviewCard({
  previewImageUrl,
  titleValue,
  titlePlaceholder,
  titleAccessibilityLabel,
  onChangeTitle,
  titleEditable = true,
  titleHint,
  children,
}: ContentPreviewCardProps) {
  return (
    <View style={styles.card}>
      {previewImageUrl ? <Image source={{ uri: previewImageUrl }} style={styles.image} /> : null}
      <View style={styles.body}>
        <TextInput
          accessibilityLabel={titleAccessibilityLabel}
          editable={titleEditable}
          onChangeText={onChangeTitle}
          placeholder={titlePlaceholder}
          style={styles.titleInput}
          value={titleValue}
        />
        {titleHint}
        <View style={styles.divider} />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // overflow:hidden so previewImage's top corners actually clip to the card's own borderRadius.
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    ...cardShadow,
  },
  image: {
    backgroundColor: colors.surfaceMuted,
    height: 180,
    width: '100%',
  },
  body: {
    padding: spacing.md + 2,
  },
  // Borderless/transparent - reads as "this content's own title, which happens to be editable"
  // rather than a boxed form field.
  titleInput: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    padding: 0,
  },
  divider: {
    backgroundColor: colors.divider,
    height: 1,
    marginVertical: spacing.sm + 2,
  },
});
