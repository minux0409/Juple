import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryEditorDialog } from './CategoryEditorDialog';
import type { CollectionIconImageChange } from './collectionIconImage';
import { CollectionUnlockDialog } from './CollectionUnlockDialog';
import { DEFAULT_COLLECTION_COLOR, type CollectionColorValue } from './collectionColors';
import { DEFAULT_COLLECTION_ICON, type CollectionIconKey } from './collectionIcons';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import type { ViewModePreferenceKey } from '../settings/viewModePreference';
import type { LoadFailureInfo } from '../components/LoadFailureState';
import { CollectionChoiceGrid } from './CollectionChoiceGrid';
import { useSheetDismissGesture } from '../components/sheetDismissGesture';
import type { Collection } from './api/collectionsApi';

// See CollectionTargetPickerDialog.tsx's identical constants/animation - the same bottom-sheet
// entrance pattern, kept local to each component rather than a new shared helper since only these
// two components need it.
const SHEET_ENTER_OFFSET = 800;
const SHEET_ENTER_DURATION_MS = 250;

interface CategoryPickerModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly collectionPool: readonly Collection[];
  readonly selectedIds: ReadonlySet<number>;
  readonly onToggle: (collection: Collection) => void;
  readonly isLoadingOptions: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly error: string | null;
  /** Only needed so the sheet can pad its own bottom past the system nav bar - each caller already
   * has this from its own useSafeAreaInsets() call, so it isn't duplicated here. */
  readonly bottomInset: number;
  readonly isCreateDialogVisible?: boolean;
  readonly onOpenCreateDialog?: () => void;
  readonly onCloseCreateDialog?: () => void;
  readonly isCreatingCollection: boolean;
  readonly createError?: string | null;
  readonly onCreateCollection?: (
    name: string,
    icon: CollectionIconKey,
    color: CollectionColorValue,
    imageChange?: CollectionIconImageChange,
  ) => Promise<boolean>;
  /** A locked Collection the user touched: its password prompt is shown over this sheet. */
  readonly unlockTarget?: Collection | null;
  readonly onUnlockGranted?: (unlockToken: string) => void;
  /** The password prompt hit a state that no longer exists (the password was removed meanwhile) - see freshCollectionAccess. */
  readonly onUnlockStateChanged?: () => Promise<boolean>;
  readonly onUnlockCancel?: () => void;
  /** Defaults to 컬렉션 선택. */
  readonly title?: string;
  /** Where this picker's own List/Grid choice is kept (so another picker's choice is never overwritten). */
  readonly viewModeKey?: ViewModePreferenceKey;
  /** The leading "+ 새 컬렉션" tile - on by default. */
  readonly showCreateTile?: boolean;
  /** The create tile's label - defaults to "+ 새로 만들기" (the Category pickers); the destination pickers say 새 컬렉션 만들기. */
  readonly createLabel?: string;
  /** What a screen reader says for the create tile when its visible label is short ("추가"). */
  readonly createAccessibilityLabel?: string;
  /** "컬렉션 없음" right after "+ 새로 만들기": an explicit choice of no Collection (see CollectionChoiceGrid). Absent = no such tile. */
  readonly noneTile?: { readonly label: string; readonly isSelected: boolean; readonly onPress: () => void };
  /** An order control (최신순 | 이름순) under the title; absent = none. */
  readonly sort?: { readonly value: 'newest' | 'title'; readonly onChange: (next: 'newest' | 'title') => void };
  /** Shown but not choosable, marked 이미 포함됨 (e.g. a Collection the link is already in). */
  readonly disabledIds?: ReadonlySet<number>;
  /**
   * A confirming action instead of the plain 닫기: "N개 선택됨" and [취소] [label], the action only
   * with something chosen. Absent = the sheet applies each tap itself and only offers 닫기.
   */
  readonly submit?: {
    readonly label: string;
    readonly onSubmit: () => void;
    readonly isSubmitting: boolean;
    /** Whether the action is available at all (default: only with something chosen). 컬렉션 변경 lets an empty choice be saved. */
    readonly enabled?: boolean;
  };
  /**
   * The Collection list could not be loaded. Nothing listed yet: a centered load-failure state INSIDE the sheet (the
   * sheet stays open). Some already listed (a next page failed): they stay, with a compact non-blocking retry row.
   */
  readonly loadFailure?: LoadFailureInfo | null;
  readonly onRetryLoad?: () => void;
}

/**
 * The "카테고리 선택" bottom-sheet modal: existing categories as an icon grid (leading with a
 * "+ 새 카테고리" tile unless showCreateTile is off) with a selected/unselected toggle per tile -
 * shared verbatim by ItemDetailsScreen and NewLinkReviewScreen, and by CollectionDetailsScreen's
 * 다른 컬렉션에 복제 (with its own title, order control, already-included Collections and a 복제
 * action - see the optional props; without them it behaves exactly as before). Selection itself (`selectedIds`/`onToggle`) stays
 * screen-owned - see useCategoryPickerModal.ts's own remarks on why. Creating a category no longer
 * has its own inline name field at the bottom of this sheet (see the removed
 * CategoryNameAndIconField) - the "+" tile instead opens the shared CategoryEditorDialog on top of
 * this still-open sheet, so the picker's own scroll position/loaded state is never disturbed by
 * creating a category from inside it.
 */
export function CategoryPickerModal({
  visible,
  onClose,
  collectionPool,
  selectedIds,
  onToggle,
  isLoadingOptions,
  isLoadingMore,
  onLoadMore,
  error,
  bottomInset,
  isCreateDialogVisible = false,
  onOpenCreateDialog = () => undefined,
  onCloseCreateDialog = () => undefined,
  isCreatingCollection,
  createError = null,
  onCreateCollection = async () => false,
  unlockTarget = null,
  onUnlockGranted = () => undefined,
  onUnlockStateChanged,
  onUnlockCancel = () => undefined,
  title,
  viewModeKey = 'categoryPickerViewMode',
  showCreateTile = true,
  createLabel,
  createAccessibilityLabel,
  noneTile,
  sort,
  disabledIds,
  submit,
  loadFailure = null,
  onRetryLoad,
}: CategoryPickerModalProps) {
  const { t } = useTranslation();
  const submitEnabled = submit ? (submit.enabled ?? selectedIds.size > 0) : false;
  const sheetTranslateY = useRef(new Animated.Value(SHEET_ENTER_OFFSET)).current;
  // Dragging the sheet down closes it like 닫기 / back (onClose) - not while a Collection is being created or the
  // confirming action runs (its close is unavailable then too).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const gesture = useSheetDismissGesture({
    dismissEnabled: !isCreatingCollection && !submit?.isSubmitting,
    isStillOpen: () => visibleRef.current,
    onDismiss: onClose,
    resetKey: visible,
  });

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

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: gesture.backdropOpacity }]} />
        <Animated.View style={[styles.content, { paddingBottom: 24 + bottomInset, transform: [{ translateY: Animated.add(sheetTranslateY, gesture.dragY) }] }]} testID="category-picker-sheet">
          <View style={styles.gridArea}>
            <CollectionChoiceGrid
              collectionPool={collectionPool}
              createAccessibilityLabel={createAccessibilityLabel}
              createLabel={createLabel}
              disabledIds={disabledIds}
              isLoadingMore={isLoadingMore}
              isLoadingOptions={isLoadingOptions}
              listStyle={styles.optionList}
              loadFailure={loadFailure}
              noneTile={noneTile}
              onLoadMore={onLoadMore}
              onOpenCreateDialog={onOpenCreateDialog}
              onRetryLoad={onRetryLoad}
              onToggle={onToggle}
              selectedIds={selectedIds}
              showCreateTile={showCreateTile}
              sort={sort}
              title={title}
              viewModeKey={viewModeKey}
              // 컬렉션 선택 + List/Grid under the shared handle: the sheet's header, so dragging it down closes it.
              sheetHeader={{ gesture, style: styles.dragArea, testID: 'category-picker-drag-area' }}
            />
          </View>
          {/* An action's result in this sheet (e.g. a Collection that became unavailable) - never a list-load failure. */}
          {error ? <Text style={styles.error} testID="category-picker-error">{error}</Text> : null}

          {submit ? (
            <View style={styles.submitBar}>
              <Text numberOfLines={1} style={styles.selectedCount} testID="category-picker-selected-count">
                {t('collections.copySelectedCount', { count: selectedIds.size })}
              </Text>
              <View style={styles.submitButtons}>
                <Pressable accessibilityRole="button" disabled={submit.isSubmitting} onPress={onClose} style={[styles.closeButton, styles.submitButton]} testID="category-picker-cancel">
                  <Text numberOfLines={1} style={styles.closeLabel}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !submitEnabled || submit.isSubmitting, busy: submit.isSubmitting }}
                  disabled={!submitEnabled || submit.isSubmitting}
                  onPress={submit.onSubmit}
                  style={[styles.primaryButton, styles.submitButton, (!submitEnabled || submit.isSubmitting) && styles.primaryDisabled]}
                  testID="category-picker-submit"
                >
                  {submit.isSubmitting ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={2} style={styles.primaryLabel}>{submit.label}</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" disabled={isCreatingCollection} onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeLabel}>{t('common.close')}</Text>
            </Pressable>
          )}
        </Animated.View>
      </View>

      <CollectionUnlockDialog collection={unlockTarget} onCancel={onUnlockCancel} onGranted={onUnlockGranted} onStateChanged={onUnlockStateChanged} />

      {isCreateDialogVisible ? (
        <CategoryEditorDialog
          error={createError}
          initialColor={DEFAULT_COLLECTION_COLOR}
          initialIcon={DEFAULT_COLLECTION_ICON}
          initialName=""
          isSubmitting={isCreatingCollection}
          mode="create"
          onCancel={onCloseCreateDialog}
          onSubmit={onCreateCollection}
          visible
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  // The dim behind the sheet - it fades as the sheet is dragged away.
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: 24,
    // The shared handle takes the top edge (see SheetHeader).
    paddingTop: 0,
  },
  // Full width (over the sheet's side padding), so the whole header block - edge to edge - is the drag area.
  dragArea: { marginHorizontal: -24, paddingHorizontal: 24 },
  gridArea: { flexShrink: 1 },
  // The sheet bounds the chooser's tiles; the 링크 저장 screen lets them fill its room instead.
  optionList: {
    maxHeight: 360,
  },
  submitBar: { gap: spacing.sm, marginTop: spacing.md },
  selectedCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  submitButtons: { flexDirection: 'row', gap: spacing.sm },
  submitButton: { flex: 1, marginTop: 0 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  closeButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 12,
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  closeLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
