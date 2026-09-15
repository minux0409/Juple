import DragList from 'react-native-draglist';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon } from '../icons/PlusIcon';
import {
  effectiveImageKey,
  effectiveImageUrl,
  isDeletable,
  MAX_EFFECTIVE_IMAGES,
  type EffectiveImage,
} from '../items/effectiveImages';
import { colors, radii, spacing } from '../theme/tokens';

interface PhotoListEditorProps {
  readonly images: readonly EffectiveImage[];
  /** True while a new photo is being added (uploaded, or staged then uploaded later) - disables the [+] button and shows a spinner in its place. */
  readonly isAdding: boolean;
  /** Keyed by effectiveImageKey() - which image(s) are mid-delete, each showing its own inline spinner instead of the × button. */
  readonly deletingKeys: ReadonlySet<string>;
  readonly onAddPhoto: () => void;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  /** react-native-draglist's own from/to-index contract - see this component's renderItem for how a drop is turned into a persisted change. */
  readonly onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * The single unified "사진" section shared by ItemDetailsScreen and NewLinkReviewScreen -
 * deliberately has no "대표 이미지"/"추가 이미지" labels or sections: every image (auto preview,
 * uploaded, or - on NewLinkReviewScreen only - still-staged) renders as one plain ordered row.
 * Whichever image is first is the Home/List thumbnail; see effectiveImages.ts for how that first
 * position is computed and persisted (CoverImageId), which this component has no knowledge of at
 * all - it only ever reports index-based reorders via onReorder and lets the caller decide what
 * that means for its own image kinds (a real ItemImage vs. a not-yet-uploaded local asset).
 */
export function PhotoListEditor({
  images,
  isAdding,
  deletingKeys,
  onAddPhoto,
  onDeleteImage,
  onReorder,
}: PhotoListEditorProps) {
  const { t } = useTranslation();
  const atCap = images.length >= MAX_EFFECTIVE_IMAGES;

  return (
    <View>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>
          {t('item.photosHeader', { count: images.length, max: MAX_EFFECTIVE_IMAGES })}
        </Text>
        <Pressable
          accessibilityLabel={t('item.addPhoto')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isAdding || atCap, busy: isAdding }}
          disabled={isAdding || atCap}
          onPress={onAddPhoto}
          style={[styles.iconButton, (isAdding || atCap) && styles.disabledButton]}
        >
          {isAdding ? (
            <ActivityIndicator color={colors.textPrimary} size="small" />
          ) : (
            <PlusIcon color={colors.textPrimary} size={20} />
          )}
        </Pressable>
      </View>
      {atCap ? (
        <Text style={styles.limitText}>{t('item.photoLimitButton', { max: MAX_EFFECTIVE_IMAGES })}</Text>
      ) : null}

      {images.length > 0 ? (
        <DragList
          contentContainerStyle={styles.listContent}
          data={[...images]}
          horizontal
          keyExtractor={effectiveImageKey}
          onReordered={onReorder}
          renderItem={({ item, index, onDragStart, onDragEnd, isActive }) => {
            const url = effectiveImageUrl(item);
            const key = effectiveImageKey(item);
            const isDeleting = deletingKeys.has(key);
            const canDelete = isDeletable(item) && !isDeleting;

            return (
              <Pressable
                accessibilityActions={
                  index > 0 ? [{ name: 'activate', label: t('item.setAsFirstPhotoA11y') }] : undefined
                }
                accessibilityHint={index > 0 ? t('item.setAsFirstPhotoA11y') : undefined}
                delayLongPress={350}
                onAccessibilityAction={() => onReorder(index, 0)}
                onLongPress={onDragStart}
                onPressOut={isActive ? onDragEnd : undefined}
                style={[styles.thumbnailWrapper, isActive && styles.thumbnailWrapperActive]}
              >
                {url ? (
                  <Image source={{ uri: url }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.thumbnail, styles.thumbnailFallback]} />
                )}
                {canDelete ? (
                  <Pressable
                    accessibilityLabel={t('item.deletePhotoA11y')}
                    accessibilityRole="button"
                    onPress={() => onDeleteImage(item)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteButtonLabel}>×</Text>
                  </Pressable>
                ) : isDeleting ? (
                  <View style={styles.deleteButton}>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  headerLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    marginEnd: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  disabledButton: {
    opacity: 0.5,
  },
  limitText: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 4,
  },
  listContent: {
    paddingVertical: 8,
  },
  thumbnailWrapper: {
    marginEnd: 10,
    position: 'relative',
  },
  thumbnailWrapperActive: {
    opacity: 0.8,
  },
  thumbnail: {
    borderRadius: radii.md,
    height: 88,
    width: 88,
  },
  thumbnailFallback: {
    backgroundColor: colors.divider,
  },
  deleteButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 11,
    end: -6,
    height: 22,
    justifyContent: 'center',
    position: 'absolute',
    top: -6,
    width: 22,
  },
  deleteButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
});
