import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PlusIcon } from '../icons/PlusIcon';
import {
  effectiveImageKey,
  effectiveImageUrl,
  isDeletable,
  MAX_EFFECTIVE_IMAGES,
  type EffectiveImage,
} from '../items/effectiveImages';
import { colors, radii, spacing } from '../theme/tokens';

const THUMBNAIL_SIZE = 88;

interface PhotoListEditorProps {
  readonly images: readonly EffectiveImage[];
  /** True while a new photo is being added (uploaded, or staged then uploaded later) - disables the [+] button and shows a spinner in its place. */
  readonly isAdding: boolean;
  /** Keyed by effectiveImageKey() - which image(s) are mid-delete, each showing its own inline spinner instead of the × button. */
  readonly deletingKeys: ReadonlySet<string>;
  readonly onAddPhoto: () => void;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  /** Reports the user's confirmed choice of a new cover/representative photo, by its current
   * index in `images` - always index 1 in practice (MAX_EFFECTIVE_IMAGES caps the list at 2, and
   * the only tappable photo is the non-representative one), but expressed as an index rather than
   * hardcoded so the caller's own reorder-to-front logic (unchanged from before) stays in charge
   * of what "representative" actually means for its own image kinds. */
  readonly onSetRepresentative: (index: number) => void;
}

/**
 * The single unified "사진" section shared by ItemDetailsScreen and NewLinkReviewScreen -
 * deliberately has no "대표 이미지"/"추가 이미지" labels or sections: every image (auto preview,
 * uploaded, or - on NewLinkReviewScreen only - still-staged) renders as one plain ordered row.
 * The first image is always the representative/cover photo - the one Home/List shows as the
 * thumbnail (see effectiveImages.ts's own remarks on how that first position is computed and
 * persisted via CoverImageId, which this component has no knowledge of at all).
 *
 * With at most MAX_EFFECTIVE_IMAGES (2) photos, "reordering" is never a drag gesture - it's a
 * single yes/no choice: tap the other (non-representative) photo, confirm, and it becomes first.
 * A prior drag-based implementation (PanResponder + Animated position + a bounded two-slot rail)
 * was replaced entirely after repeatedly fighting visual-sync bugs between the drag gesture's
 * live position and the underlying list order (see git history) - a tap+confirm has no gesture
 * state to keep in sync with anything, so that whole class of bug is structurally impossible here.
 */
export function PhotoListEditor({
  images,
  isAdding,
  deletingKeys,
  onAddPhoto,
  onDeleteImage,
  onSetRepresentative,
}: PhotoListEditorProps) {
  const { t } = useTranslation();
  const atCap = images.length >= MAX_EFFECTIVE_IMAGES;
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

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
        <View style={styles.photoRow}>
          {images.map((image, index) => (
            <PhotoThumbnail
              deletingKeys={deletingKeys}
              image={image}
              isRepresentative={index === 0}
              key={effectiveImageKey(image)}
              onDeleteImage={onDeleteImage}
              onRequestSetRepresentative={index > 0 ? () => setPendingIndex(index) : undefined}
            />
          ))}
        </View>
      ) : null}

      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('item.setRepresentativeConfirm')}
        destructive={false}
        message={t('item.setRepresentativeConfirmMessage')}
        onCancel={() => setPendingIndex(null)}
        onConfirm={() => {
          if (pendingIndex !== null) {
            onSetRepresentative(pendingIndex);
          }
          setPendingIndex(null);
        }}
        title={t('item.setRepresentativeConfirmTitle')}
        visible={pendingIndex !== null}
      />
    </View>
  );
}

interface PhotoThumbnailProps {
  readonly image: EffectiveImage;
  readonly deletingKeys: ReadonlySet<string>;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  readonly isRepresentative: boolean;
  /** Present only for a non-representative photo - tapping it asks to make it the new
   * representative. Absent (and the thumbnail rendered as a plain, non-interactive View) for the
   * current representative - tapping it does nothing, per this feature's own UX (section 2: no
   * dialog, no-op) rather than a Pressable that visibly reacts to touch but changes nothing. */
  readonly onRequestSetRepresentative?: () => void;
}

function PhotoThumbnail({
  image,
  deletingKeys,
  onDeleteImage,
  isRepresentative,
  onRequestSetRepresentative,
}: PhotoThumbnailProps) {
  const { t } = useTranslation();
  const key = effectiveImageKey(image);
  const url = effectiveImageUrl(image);
  const isDeleting = deletingKeys.has(key);
  const canDelete = isDeletable(image) && !isDeleting;

  const content = (
    <>
      {url ? (
        <Image source={{ uri: url }} style={styles.thumbnail} />
      ) : (
        <View style={[styles.thumbnail, styles.thumbnailFallback]} />
      )}
      {isRepresentative ? (
        <View style={styles.representativeBadge}>
          <Text style={styles.representativeBadgeLabel}>{t('item.representativeBadge')}</Text>
        </View>
      ) : null}
      {canDelete ? (
        <Pressable
          accessibilityLabel={t('item.deletePhotoA11y')}
          accessibilityRole="button"
          onPress={() => onDeleteImage(image)}
          style={styles.deleteButton}
        >
          <Text style={styles.deleteButtonLabel}>×</Text>
        </Pressable>
      ) : isDeleting ? (
        <View style={styles.deleteButton}>
          <ActivityIndicator color="#FFFFFF" size="small" />
        </View>
      ) : null}
    </>
  );

  if (onRequestSetRepresentative) {
    return (
      <Pressable
        accessibilityLabel={t('item.setAsFirstPhotoA11y')}
        accessibilityRole="button"
        onPress={onRequestSetRepresentative}
        style={styles.thumbnailWrapper}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={t('item.representativePhotoA11y')} style={styles.thumbnailWrapper}>
      {content}
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
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnail: {
    borderRadius: radii.md,
    height: THUMBNAIL_SIZE,
    width: THUMBNAIL_SIZE,
  },
  thumbnailFallback: {
    backgroundColor: colors.divider,
  },
  // Compact, corner-anchored - deliberately small so it never meaningfully covers the photo
  // itself (see this feature's own UX guidance against a large overlay).
  representativeBadge: {
    backgroundColor: colors.brand,
    borderRadius: radii.sm,
    bottom: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
  },
  representativeBadgeLabel: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: '700',
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
