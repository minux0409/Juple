import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CollectionChoiceGrid } from './CollectionChoiceGrid';
import type { Collection } from './api/collectionsApi';
import { colors, radii, spacing, themedStyles } from '../theme/tokens';
import { useSheetDismissGesture } from '../components/sheetDismissGesture';
import { KeyboardFieldScope } from '../components/keyboardToolbar';

// Comfortably past this component's own maxHeight ('75%') on any real device, so the sheet always
// starts fully off-screen below regardless of exact screen height - see the entrance animation
// below for why a precise Dimensions-based value isn't needed.
const SHEET_ENTER_OFFSET = 800;
const SHEET_ENTER_DURATION_MS = 250;
const NO_SELECTION: ReadonlySet<number> = new Set();

/**
 * 병합 target selection (CollectionDetailsScreen's targetMode) - a bottom
 * sheet whose Cancel row must stay fully above the Android system navigation area (gesture bar or
 * 3-button nav), never underneath it. useSafeAreaInsets() is read directly here (not a prop
 * threaded through from the one current caller) so every caller of this shared component - now
 * and any added later - gets the fix automatically.
 *
 * animationType="none" - RN's own "slide" animates the *entire* Modal window (transparent
 * backdrop included), which visibly drags the dim backdrop up from the bottom together with the
 * sheet, drawing the eye to motion that shouldn't be there. The backdrop below renders at its
 * final dim color the instant the Modal itself appears (no animation of its own); only the white
 * sheet content animates in, via a plain Animated.Value translateY (no new dependency). Closing is
 * a plain instant cut (matching animationType="none") rather than a mirrored slide-down - the
 * explicit ask here was fixing the backdrop’s *opening* motion, and a hand-rolled reverse-animate-
 * then-close would need to delay onCancel/onRequestClose itself, real complexity for a currently
 * unreported problem.
 */
export function CollectionTargetPickerDialog({ visible, collections, isLoading, isLoadingMore, onSelect, onCancel, onLoadMore, title }: {
  readonly visible: boolean; readonly collections: readonly Collection[]; readonly isLoading: boolean;
  readonly onSelect: (collection: Collection) => void; readonly onCancel: () => void; readonly onLoadMore: () => void; readonly isLoadingMore: boolean;
  /** Defaults to 컬렉션 선택. */
  readonly title?: string;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const sheetTranslateY = useRef(new Animated.Value(SHEET_ENTER_OFFSET)).current;
  // Dragging the sheet down cancels it, exactly like its 취소 row / back (onCancel).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const gesture = useSheetDismissGesture({ isStillOpen: () => visibleRef.current, onDismiss: onCancel, resetKey: visible });

  useEffect(() => {
    if (!visible) {
      return;
    }
    sheetTranslateY.setValue(SHEET_ENTER_OFFSET);
    Animated.timing(sheetTranslateY, {
      toValue: 0,
      duration: SHEET_ENTER_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, sheetTranslateY]);

  return <Modal animationType="none" onRequestClose={onCancel} transparent visible={visible}>
    <KeyboardFieldScope>
    <View style={styles.overlay}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: gesture.backdropOpacity }]} />
      <Animated.View style={[styles.card, { paddingBottom: spacing.xl + insets.bottom, transform: [{ translateY: Animated.add(sheetTranslateY, gesture.dragY) }] }]} testID="collection-target-sheet">
      {/* The one shared Collection chooser: List | Grid (the same 4-column tiles as the other pickers, rows in List), paging, locked marks.
          A tap picks the target at once (no multi-select), so nothing is shown as chosen. */}
      <CollectionChoiceGrid
        collectionPool={collections}
        defaultViewMode="list"
        isLoadingMore={isLoadingMore}
        isLoadingOptions={isLoading}
        listStyle={styles.listArea}
        onLoadMore={onLoadMore}
        onToggle={onSelect}
        selectedIds={NO_SELECTION}
        sheetHeader={{ gesture, style: styles.dragArea, testID: 'collection-target-drag-area' }}
        showCreateTile={false}
        title={title ?? t('collections.targetPickerTitle')}
      />
      <Pressable accessibilityLabel={t('common.cancel')} accessibilityRole="button" onPress={onCancel} style={styles.cancel}><Text style={styles.cancelLabel}>{t('common.cancel')}</Text></Pressable>
    </Animated.View></View>
    </KeyboardFieldScope>
  </Modal>;
}
const styles = themedStyles(() => ({ overlay: { flex: 1, justifyContent: 'flex-end' }, backdrop: { backgroundColor: 'rgba(0,0,0,0.4)' }, card: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: '75%', padding: spacing.xl, paddingTop: 0 }, dragArea: { marginHorizontal: -spacing.xl, paddingHorizontal: spacing.xl }, listArea: { flexShrink: 1 }, cancel: { alignItems: 'center', paddingTop: spacing.lg }, cancelLabel: { color: colors.textPrimary } }));
