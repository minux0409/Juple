import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { PlusIcon } from '../icons/PlusIcon';
import {
  effectiveImageKey,
  effectiveImageUrl,
  isDeletable,
  MAX_EFFECTIVE_IMAGES,
  type EffectiveImage,
} from '../items/effectiveImages';
import { colors, radii, spacing } from '../theme/tokens';
import {
  clampCenterX,
  computeSlotPitch,
  resolveDrop,
  slotCenterX,
  THUMBNAIL_GAP,
  THUMBNAIL_SIZE,
  type SlotIndex,
} from './twoSlotDrag';

interface PhotoListEditorProps {
  readonly images: readonly EffectiveImage[];
  /** True while a new photo is being added (uploaded, or staged then uploaded later) - disables the [+] button and shows a spinner in its place. */
  readonly isAdding: boolean;
  /** Keyed by effectiveImageKey() - which image(s) are mid-delete, each showing its own inline spinner instead of the × button. */
  readonly deletingKeys: ReadonlySet<string>;
  readonly onAddPhoto: () => void;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  /** Reports a completed reorder as a [fromIndex, toIndex] pair - identical contract to before, so neither caller (ItemDetailsScreen/NewLinkReviewScreen) needed to change. */
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
 *
 * With at most MAX_EFFECTIVE_IMAGES (2) photos, reordering is never a generic list-drag problem -
 * see PhotoTrack below for the actual bounded, measured-layout drag implementation and
 * twoSlotDrag.ts for its pure geometry.
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

      {images.length === 2 ? (
        <PhotoTrack
          deletingKeys={deletingKeys}
          images={[images[0], images[1]]}
          onDeleteImage={onDeleteImage}
          onReorder={onReorder}
        />
      ) : images.length === 1 ? (
        // A single photo has nothing to reorder against - a plain, non-draggable thumbnail (still
        // deletable) so a stray long-press never has anything to "drag" into, and no PanResponder
        // is ever attached at all.
        <View style={styles.singlePhotoRow}>
          <PhotoThumbnail
            deletingKeys={deletingKeys}
            image={images[0]}
            onDeleteImage={onDeleteImage}
          />
        </View>
      ) : null}
    </View>
  );
}

interface PhotoThumbnailProps {
  readonly image: EffectiveImage;
  readonly deletingKeys: ReadonlySet<string>;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  /** Only present for the second (index 1) slot of a 2-photo track - see PhotoTrack. */
  readonly accessibilityActionA11yLabel?: string;
  readonly onSetAsFirst?: () => void;
}

function PhotoThumbnail({
  image,
  deletingKeys,
  onDeleteImage,
  accessibilityActionA11yLabel,
  onSetAsFirst,
}: PhotoThumbnailProps) {
  const { t } = useTranslation();
  const key = effectiveImageKey(image);
  const url = effectiveImageUrl(image);
  const isDeleting = deletingKeys.has(key);
  const canDelete = isDeletable(image) && !isDeleting;

  return (
    <View
      accessibilityActions={onSetAsFirst ? [{ name: 'activate', label: accessibilityActionA11yLabel }] : undefined}
      accessibilityHint={accessibilityActionA11yLabel}
      accessible={Boolean(onSetAsFirst)}
      onAccessibilityAction={onSetAsFirst}
      style={styles.thumbnailWrapper}
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
    </View>
  );
}

interface PhotoTrackProps {
  readonly images: readonly [EffectiveImage, EffectiveImage];
  readonly deletingKeys: ReadonlySet<string>;
  readonly onDeleteImage: (image: EffectiveImage) => void;
  readonly onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * A fixed, bounded "virtual track" (see twoSlotDrag.ts) - never an unbounded drag canvas. The
 * track's own width is measured via onLayout (never a hardcoded guess), subdivided into a handful
 * of virtual slot positions; the two photos always rest exactly at slot 0's and slot 1's centers.
 * `overflow: hidden` on the track itself is a structural backstop: even if some transform bug ever
 * produced a wildly wrong offset, the photo could never become visible outside the track's bounds.
 *
 * Each photo's resting `left` is a plain (non-animated) style derived from its current logical
 * index in `images` - it only ever changes on the discrete render right after a completed
 * onReorder swap. Drag movement itself is a separate, always-X-only Animated value layered on top
 * via `transform: translateX`, reset to 0 the instant a gesture ends - which is what makes "no
 * vertical movement, ever" a structural guarantee rather than something clamped at runtime (Y is
 * never computed anywhere in this file).
 *
 * Long-press-to-activate: the responder is claimed immediately on touch-down (so it can see raw
 * movement), but a drag is only actually armed once an ~180ms hold timer fires. Earlier rounds
 * cancelled that pending timer the moment *any* movement (including the very drag direction this
 * is supposed to detect) exceeded a few px - which is why a real finger almost never managed to
 * activate a drag at all (nobody holds perfectly still for 180ms before starting to move in the
 * direction they meant to drag). The timer here is only cancelled by a clearly-vertical gesture
 * (dy meaningfully larger than dx, past a human-tremor-tolerant threshold), which still lets a
 * genuine scroll started on a thumbnail fall through to the page normally.
 */
function PhotoTrack({ images, deletingKeys, onDeleteImage, onReorder }: PhotoTrackProps) {
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const [draggingIndex, setDraggingIndex] = useState<SlotIndex | null>(null);
  const draggingIndexRef = useRef<SlotIndex | null>(null);

  // One Animated.Value per fixed slot (not per photo - a photo's own value follows whichever slot
  // it currently occupies in the `images` array, which only changes after a drop). Always X-only.
  const slot0Offset = useRef(new Animated.Value(0)).current;
  const slot1Offset = useRef(new Animated.Value(0)).current;
  const slotOffsets = useRef<readonly [Animated.Value, Animated.Value]>([slot0Offset, slot1Offset]).current;
  const isPreviewingSwapRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // responder0/responder1 below are created exactly once (see their own useRef(...).current
  // comment) and must never go stale across re-renders - onReorder is a fresh closure over
  // effectivePhotoImages/item every time the parent (ItemDetailsScreen/NewLinkReviewScreen)
  // re-renders, so onPanResponderRelease reads it through this ref (always the latest prop) instead
  // of closing over the `onReorder` parameter directly. Assigning a ref during render like this is
  // safe - it only affects a later event callback, never anything read during this render itself.
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    trackWidthRef.current = width;
    setTrackWidth(width);
  };

  // A sane fallback pitch for the one frame (if any) before the first onLayout measurement lands -
  // never used for anything beyond that initial paint.
  const slotPitch = trackWidth > 0 ? computeSlotPitch(trackWidth) : THUMBNAIL_SIZE + THUMBNAIL_GAP;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetOffsets = () => {
    slot0Offset.setValue(0);
    slot1Offset.setValue(0);
    isPreviewingSwapRef.current = false;
  };

  function createResponderFor(index: SlotIndex) {
    const otherIndex: SlotIndex = index === 0 ? 1 : 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onPanResponderGrant: () => {
        clearLongPressTimer();
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          draggingIndexRef.current = index;
          setDraggingIndex(index);
        }, 180);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (draggingIndexRef.current !== index) {
          // Not activated yet - only a clearly-vertical gesture (well past ordinary hand tremor,
          // and meaningfully more vertical than horizontal) cancels the pending timer here; any
          // other movement - including the start of the intended horizontal drag itself - is left
          // alone so the timer gets its full ~180ms to actually fire. See this component's own
          // top-level remarks for why the previous, much tighter threshold effectively made
          // real-finger drags never activate at all.
          if (Math.abs(gestureState.dy) > 24 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5) {
            clearLongPressTimer();
          }
          return;
        }

        const width = trackWidthRef.current;
        if (width <= 0) {
          return;
        }
        const restingCenterX = slotCenterX(index, slotPitch);
        const liveCenterX = clampCenterX(restingCenterX + gestureState.dx, width);
        slotOffsets[index].setValue(liveCenterX - restingCenterX);

        const crossed = hasCrossedOtherCenterSafe(index, liveCenterX, slotPitch);
        if (crossed !== isPreviewingSwapRef.current) {
          isPreviewingSwapRef.current = crossed;
          const otherRestingCenterX = slotCenterX(otherIndex, slotPitch);
          Animated.timing(slotOffsets[otherIndex], {
            toValue: crossed ? restingCenterX - otherRestingCenterX : 0,
            duration: 150,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        clearLongPressTimer();
        if (draggingIndexRef.current !== index) {
          return;
        }

        const width = trackWidthRef.current;
        const restingCenterX = slotCenterX(index, slotPitch);
        const liveCenterX = width > 0 ? clampCenterX(restingCenterX + gestureState.dx, width) : restingCenterX;
        const drop = width > 0 ? resolveDrop(index, liveCenterX, slotPitch) : null;
        draggingIndexRef.current = null;
        setDraggingIndex(null);
        // Every photo's resting `left` is recomputed from its (possibly now-swapped) logical
        // index on the very next render - snapping the drag offsets back to 0 here in the same
        // update lands each photo exactly where it visually already was, with no jump.
        resetOffsets();
        if (drop) {
          onReorderRef.current(drop.from, drop.to);
        }
      },
      onPanResponderTerminate: () => {
        clearLongPressTimer();
        if (draggingIndexRef.current === index) {
          draggingIndexRef.current = null;
          setDraggingIndex(null);
          resetOffsets();
        }
      },
      // Freely give the responder back to the page's own vertical ScrollView before a drag has
      // activated - refuse to once it has, so an in-progress reorder is never interrupted mid-drag.
      onPanResponderTerminationRequest: () => draggingIndexRef.current !== index,
    });
  }

  const responder0 = useRef(createResponderFor(0)).current;
  const responder1 = useRef(createResponderFor(1)).current;
  const responders = [responder0, responder1] as const;

  return (
    <View onLayout={handleTrackLayout} style={styles.photoTrack}>
      {images.map((image, index) => {
        const slotIndex = index as SlotIndex;
        const isActive = draggingIndex === slotIndex;
        const left = slotCenterX(slotIndex, slotPitch) - THUMBNAIL_SIZE / 2;
        return (
          <Animated.View
            key={effectiveImageKey(image)}
            style={[
              styles.trackItem,
              isActive ? styles.slotActive : styles.slotInactive,
              {
                left,
                transform: [{ translateX: slotOffsets[slotIndex] }, { scale: isActive ? 1.08 : 1 }],
              },
            ]}
            {...responders[slotIndex].panHandlers}
          >
            <View style={isActive ? styles.thumbnailWrapperActive : undefined}>
              <PhotoThumbnail
                accessibilityActionA11yLabel={slotIndex > 0 ? t('item.setAsFirstPhotoA11y') : undefined}
                deletingKeys={deletingKeys}
                image={image}
                onDeleteImage={onDeleteImage}
                onSetAsFirst={slotIndex > 0 ? () => onReorder(slotIndex, 0) : undefined}
              />
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** hasCrossedOtherCenter, guarded for the (only-ever-momentary) trackWidth<=0 window before the
 * first onLayout measurement - never crosses if there is nothing sane to measure against yet. */
function hasCrossedOtherCenterSafe(draggedIndex: SlotIndex, liveCenterX: number, slotPitch: number): boolean {
  if (!(slotPitch > 0)) {
    return false;
  }
  const otherIndex: SlotIndex = draggedIndex === 0 ? 1 : 0;
  const otherCenterX = slotCenterX(otherIndex, slotPitch);
  return draggedIndex === 0 ? liveCenterX > otherCenterX : liveCenterX < otherCenterX;
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
  singlePhotoRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  // The bounded, measured drag track (see PhotoTrack's own remarks) - a fixed height and full
  // available width (not shrink-wrapped: a wider measured track is what gives drag movement real
  // room), with `overflow: hidden` as a structural backstop against a photo ever becoming visible
  // outside these exact bounds, regardless of any transform value.
  photoTrack: {
    height: THUMBNAIL_SIZE + 16,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  // Absolutely positioned within photoTrack - `top` is a fixed constant, never touched by drag
  // logic (only `left`, set per-render from the photo's current logical slot, and the Animated
  // `transform: translateX` layered on top of it - see PhotoTrack's own remarks on why that
  // structurally rules out any vertical movement).
  trackItem: {
    position: 'absolute',
    top: 8,
  },
  // The active slot paints above its resting sibling (elevation also affects Android z-order, not
  // just the shadow) regardless of which direction it's being dragged.
  slotActive: {
    elevation: 8,
    zIndex: 10,
  },
  slotInactive: {
    elevation: 0,
    zIndex: 0,
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  // Deliberately a large, immediate jump (not an animated transition) the instant a drag activates,
  // so "this is now movable" never depends on the user noticing a gradual change - border/shadow
  // together with the slot's own scale transform (not just one) so it still reads clearly on both
  // light and dark thumbnails.
  thumbnailWrapperActive: {
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  thumbnail: {
    borderRadius: radii.md,
    height: THUMBNAIL_SIZE,
    width: THUMBNAIL_SIZE,
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
