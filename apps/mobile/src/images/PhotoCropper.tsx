import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Modal, PanResponder, Text, View, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { cropSquare, type CroppedImage } from './cropImage';
import { CROP_OUTPUT_MAX, MAX_ZOOM, MIN_ZOOM, coverScale, cropRect, distance, initialView, panBy, zoomTo, type CropView } from './cropMath';
import { KeyboardFieldScope } from '../components/keyboardToolbar';

const PREVIEW = 72;
const ZOOM_STEP = 0.25;
const MAX_VIEWPORT = 320;
/** The side padding of the screen the square must leave free. */
const SIDE_MARGIN = spacing.xl;

interface PhotoCropperProps {
  /** The picked photo (a file on this device). The cropper is mounted only while a photo is being fitted. */
  readonly uri: string;
  /**
   * The photo's size in the orientation the person sees, when the picker reported it (both platforms report it with EXIF applied); the crop
   * is then measured in exactly the space the native crop works in. Without it the size is read from the file (Image.getSize).
   */
  readonly knownSize?: { readonly width?: number; readonly height?: number };
  /** The cropped square, as a new file - the caller uploads it through its existing flow. */
  readonly onApply: (cropped: CroppedImage) => void;
  /** Cancel, the Android back button or the iOS dismiss: nothing is changed. */
  readonly onCancel: () => void;
  /**
   * What the square becomes - it decides how the kept area is outlined and what the screen is called: a profile photo is shown as a
   * circle; a Collection's photo fills its rounded tile; a link's own photo fills the link card's (slightly rounded) picture.
   */
  readonly variant?: CropVariant;
}

export type CropVariant = 'profile' | 'collection' | 'link';

/** How each use outlines the kept square (corner radius as a share of its side) and the size of the file it produces. */
const VARIANTS: Record<CropVariant, { readonly cornerRatio: number; readonly maxSide: number; readonly fileName: string }> = {
  profile: { cornerRatio: 0.5, maxSide: CROP_OUTPUT_MAX, fileName: 'profile.jpg' },
  // CategoryIconTile: radius radii.md + size / 8 on a 48pt tile.
  collection: { cornerRatio: 14 / 48, maxSide: CROP_OUTPUT_MAX, fileName: 'collection.jpg' },
  // A link card's picture is a square with a small rounding; it is shown up to a whole Grid card wide, hence the larger file.
  link: { cornerRatio: 0.08, maxSide: 1024, fileName: 'link.jpg' },
};

/**
 * A full-screen square photo crop: drag to move, pinch (or the +/- buttons, or an accessibility swipe up/down) to zoom, a circle shows how
 * the photo will be displayed and a small live preview beside the zoom buttons shows the result. The photo always covers the square
 * (no empty strip) and can be zoomed up to MAX_ZOOM. Apply cuts exactly the visible square out of the file (cropSquare) - on a device,
 * a fresh image without the original's metadata - and returns it; Cancel (or back) returns nothing. Written for any square picture: a
 * Collection cover can use it later.
 */
export function PhotoCropper({ uri, knownSize, onApply, onCancel, variant = 'profile' }: PhotoCropperProps) {
  const shape = VARIANTS[variant];
  const { t } = useTranslation();
  useTheme(); // memoised styles are rebuilt for the theme in force
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const viewport = Math.min(MAX_VIEWPORT, Math.max(200, windowWidth - SIDE_MARGIN * 2));

  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sizeRef = useRef(size);
  const viewportRef = useRef(viewport);
  sizeRef.current = size;
  viewportRef.current = viewport;

  useEffect(() => {
    setSize(null);
    setView(null);
    setFailed(false);
    if (knownSize?.width && knownSize.height && knownSize.width > 0 && knownSize.height > 0) {
      setSize({ width: knownSize.width, height: knownSize.height });
      setView(initialView(knownSize.width, knownSize.height, viewportRef.current));
      return undefined;
    }
    let active = true;
    Image.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) {
          setSize({ width, height });
          setView(initialView(width, height, viewportRef.current));
        } else if (active) {
          setFailed(true);
        }
      },
      () => {
        if (active) {
          setFailed(true);
        }
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the size hint belongs to this uri
  }, [uri]);

  const change = useCallback((next: (current: CropView, width: number, height: number, side: number) => CropView) => {
    const current = sizeRef.current;
    if (!current) {
      return;
    }
    setView(previous => (previous ? next(previous, current.width, current.height, viewportRef.current) : previous));
  }, []);

  const gesture = useRef({ x: 0, y: 0, pinchDistance: 0, pinchZoom: 1, pinching: false });
  const viewRef = useRef<CropView | null>(null);
  viewRef.current = view;
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event => {
          const touches = event.nativeEvent.touches;
          gesture.current.pinching = false;
          gesture.current.x = touches[0]?.pageX ?? 0;
          gesture.current.y = touches[0]?.pageY ?? 0;
        },
        onPanResponderMove: event => {
          const touches = event.nativeEvent.touches;
          if (touches.length >= 2) {
            const a = { x: touches[0].pageX, y: touches[0].pageY };
            const b = { x: touches[1].pageX, y: touches[1].pageY };
            const span = distance(a, b);
            if (!gesture.current.pinching) {
              gesture.current.pinching = true;
              gesture.current.pinchDistance = Math.max(1, span);
              gesture.current.pinchZoom = viewRef.current?.zoom ?? MIN_ZOOM;
              return;
            }
            const nextZoom = gesture.current.pinchZoom * (span / gesture.current.pinchDistance);
            change((current, width, height, side) => zoomTo(current, nextZoom, width, height, side));
            return;
          }
          if (gesture.current.pinching) {
            // one finger lifted: continue as a drag from where the remaining finger is
            gesture.current.pinching = false;
            gesture.current.x = touches[0]?.pageX ?? 0;
            gesture.current.y = touches[0]?.pageY ?? 0;
            return;
          }
          const x = touches[0]?.pageX ?? gesture.current.x;
          const y = touches[0]?.pageY ?? gesture.current.y;
          const dx = x - gesture.current.x;
          const dy = y - gesture.current.y;
          gesture.current.x = x;
          gesture.current.y = y;
          change((current, width, height, side) => panBy(current, dx, dy, width, height, side));
        },
      }),
    [change],
  );

  const zoomBy = (delta: number) => change((current, width, height, side) => zoomTo(current, current.zoom + delta, width, height, side));

  const apply = async () => {
    if (busyRef.current || !size || !view) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      onApply(await cropSquare(uri, cropRect(view, size.width, size.height, viewport), { maxSide: shape.maxSide, fileName: shape.fileName }));
    } catch {
      setFailed(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!busyRef.current) {
      onCancel();
    }
  };

  const scale = size && view ? coverScale(size.width, size.height, viewport) * view.zoom : 1;
  const imageBox = (ratio: number) =>
    size && view ? { height: size.height * scale * ratio, left: view.x * ratio, top: view.y * ratio, width: size.width * scale * ratio } : { height: 0, width: 0 };
  const ready = size !== null && view !== null && !failed;

  return (
    <Modal animationType="slide" onRequestClose={cancel} presentationStyle="fullScreen" statusBarTranslucent visible>
      <KeyboardFieldScope>
      <View style={[styles.screen, { paddingBottom: insets.bottom, paddingTop: insets.top }]} testID="photo-cropper">
        <View style={styles.header}>
          <Pressable accessibilityLabel={t('common.cancel')} accessibilityRole="button" disabled={busy} hitSlop={8} onPress={cancel} style={styles.headerButton} testID="photo-cropper-cancel">
            <Text numberOfLines={1} style={styles.headerCancel}>{t('common.cancel')}</Text>
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{t(variant === 'profile' ? 'profileCrop.title' : `profileCrop.${variant}Title`)}</Text>
          <Pressable
            accessibilityLabel={t('profileCrop.apply')}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy || !ready }}
            disabled={busy || !ready}
            hitSlop={8}
            onPress={() => { apply().catch(() => undefined); }}
            style={styles.headerButton}
            testID="photo-cropper-apply"
          >
            {busy ? <ActivityIndicator color={colors.brandText} size="small" /> : <Text numberOfLines={1} style={[styles.headerApply, !ready && styles.disabled]}>{t('profileCrop.apply')}</Text>}
          </Pressable>
        </View>

        <Text style={styles.hint}>{t('profileCrop.hint')}</Text>

        <View style={styles.stage}>
          <View
            accessibilityActions={[{ name: 'increment', label: t('profileCrop.zoomIn') }, { name: 'decrement', label: t('profileCrop.zoomOut') }]}
            accessibilityLabel={t('profileCrop.areaA11y')}
            accessibilityRole="adjustable"
            accessible
            onAccessibilityAction={event => {
              if (event.nativeEvent.actionName === 'increment') {
                zoomBy(ZOOM_STEP);
              } else if (event.nativeEvent.actionName === 'decrement') {
                zoomBy(-ZOOM_STEP);
              }
            }}
            style={[styles.viewport, { height: viewport, width: viewport }]}
            testID="photo-cropper-area"
            {...responder.panHandlers}
          >
            {size ? <Image pointerEvents="none" resizeMode="stretch" source={{ uri }} style={[styles.photo, imageBox(1)]} testID="photo-cropper-photo" /> : <ActivityIndicator color={colors.textSecondary} />}
            {/* The shape that stays (a circle for a profile, the tile's / card's rounded square otherwise); everything around it is dimmed
                (a thick ring, clipped by the square: its outer radius is the hole's radius plus the ring's width). */}
            <View pointerEvents="none" style={[styles.mask, { borderRadius: viewport * shape.cornerRatio + viewport, borderWidth: viewport, height: viewport * 3, left: -viewport, top: -viewport, width: viewport * 3 }]} />
            <View pointerEvents="none" style={[styles.circleLine, { borderRadius: viewport * shape.cornerRatio, height: viewport, width: viewport }]} />
          </View>
        </View>

        <View style={[styles.controls, { width: viewport }]}>
          <View style={styles.zoomRow}>
            <Pressable accessibilityLabel={t('profileCrop.zoomOut')} accessibilityRole="button" accessibilityState={{ disabled: !ready || (view?.zoom ?? MIN_ZOOM) <= MIN_ZOOM }} disabled={!ready} onPress={() => zoomBy(-ZOOM_STEP)} style={styles.zoomButton} testID="photo-cropper-zoom-out">
              <Text style={styles.zoomGlyph}>−</Text>
            </Pressable>
            <Text accessibilityRole="text" style={styles.zoomLabel}>{`${t('profileCrop.zoom')} ${Math.round((view?.zoom ?? MIN_ZOOM) * 100)}%`}</Text>
            <Pressable accessibilityLabel={t('profileCrop.zoomIn')} accessibilityRole="button" accessibilityState={{ disabled: !ready || (view?.zoom ?? MIN_ZOOM) >= MAX_ZOOM }} disabled={!ready} onPress={() => zoomBy(ZOOM_STEP)} style={styles.zoomButton} testID="photo-cropper-zoom-in">
              <Text style={styles.zoomGlyph}>+</Text>
            </Pressable>
          </View>
          <View accessibilityLabel={t('profileCrop.preview')} accessibilityRole="image" style={[styles.previewCircle, { borderRadius: PREVIEW * shape.cornerRatio }]} testID="photo-cropper-preview">
            {size ? <Image resizeMode="stretch" source={{ uri }} style={[styles.photo, imageBox(PREVIEW / viewport)]} /> : null}
          </View>
        </View>

        <Text style={styles.note}>{t(variant === 'profile' ? 'profileCrop.note' : `profileCrop.${variant}Note`)}</Text>
        {failed ? <Text accessibilityLiveRegion="polite" style={styles.error} testID="photo-cropper-error">{t('profile.photoInvalid')}</Text> : null}
      </View>
      </KeyboardFieldScope>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  screen: { backgroundColor: colors.background, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  headerButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: 64 },
  headerCancel: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  headerApply: { color: colors.brandText, fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  hint: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, textAlign: 'center' },
  stage: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  viewport: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, justifyContent: 'center', overflow: 'hidden' },
  photo: { position: 'absolute' },
  mask: { borderColor: colors.scrim, position: 'absolute' },
  circleLine: { borderColor: 'rgba(255, 255, 255, 0.85)', borderWidth: 2, position: 'absolute' },
  controls: { alignItems: 'center', alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.md },
  zoomRow: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
  zoomButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  zoomGlyph: { color: colors.textPrimary, fontSize: 22, fontWeight: '600', lineHeight: 26 },
  zoomLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 13, textAlign: 'center' },
  previewCircle: { backgroundColor: colors.surfaceMuted, borderColor: colors.inputBorder, borderRadius: PREVIEW / 2, borderWidth: 1, height: PREVIEW, marginStart: spacing.md, overflow: 'hidden', width: PREVIEW },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingBottom: spacing.md, paddingHorizontal: spacing.xl, textAlign: 'center' },
  error: { color: colors.dangerText, fontSize: 14, paddingBottom: spacing.md, paddingHorizontal: spacing.xl, textAlign: 'center' },
}));
