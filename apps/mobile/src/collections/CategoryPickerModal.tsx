import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Easing, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryEditorDialog } from './CategoryEditorDialog';
import { CategoryIconTile } from './CategoryIconTile';
import { DEFAULT_COLLECTION_COLOR, type CollectionColorValue } from './collectionColors';
import { DEFAULT_COLLECTION_ICON, type CollectionIconKey } from './collectionIcons';
import { CheckIcon } from '../icons/CheckIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference } from '../settings/viewModePreference';
import type { Collection } from './api/collectionsApi';

// See CollectionTargetPickerDialog.tsx's identical constants/animation - the same bottom-sheet
// entrance pattern, kept local to each component rather than a new shared helper since only these
// two components need it.
const SHEET_ENTER_OFFSET = 800;
const SHEET_ENTER_DURATION_MS = 250;

const GRID_COLUMNS = 4;

/** Stable sentinel identifying the leading "+ 새 카테고리" tile in the grid's data array - never a
 * real Collection, so `'id' in item` (see renderItem) reliably tells the two apart. */
const CREATE_TILE = { kind: 'create' } as const;
type GridItem = typeof CREATE_TILE | Collection;

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
  ) => Promise<boolean>;
}

/**
 * The "카테고리 선택" bottom-sheet modal: existing categories as an icon grid (always leading with
 * a "+ 새 카테고리" tile) with a selected/unselected toggle per tile - shared verbatim by
 * ItemDetailsScreen and NewLinkReviewScreen. Selection itself (`selectedIds`/`onToggle`) stays
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
}: CategoryPickerModalProps) {
  const { t } = useTranslation();
  const { viewMode, changeViewMode } = useViewModePreference('categoryPickerViewMode', 'grid');
  const sheetTranslateY = useRef(new Animated.Value(SHEET_ENTER_OFFSET)).current;

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

  const gridData: readonly GridItem[] = [CREATE_TILE, ...collectionPool];

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.content, { paddingBottom: 24 + bottomInset, transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.titleRow}><Text style={styles.title}>{t('collections.selectTitle')}</Text><ViewModeToggle onChange={changeViewMode} value={viewMode} /></View>

          {isLoadingOptions ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <FlatList
              key={viewMode}
              data={gridData}
              extraData={selectedIds}
              keyExtractor={item => ('kind' in item ? 'create' : item.id.toString())}
              numColumns={viewMode === 'grid' ? GRID_COLUMNS : 1}
              onEndReached={onLoadMore}
              onEndReachedThreshold={0.5}
              renderItem={({ item }) => {
                if ('kind' in item) {
                  return (
                    <Pressable
                      accessibilityLabel={t('collections.addNew')}
                      accessibilityRole="button"
                      onPress={onOpenCreateDialog}
                      style={viewMode === 'grid' ? styles.gridCell : styles.listCell}
                    >
                      <View style={styles.createTile}>
                        <PlusIcon color={colors.brand} size={22} strokeWidth={2.25} />
                      </View>
                      <Text numberOfLines={1} style={[styles.tileLabel, viewMode === 'list' && styles.listLabel]}>
                        {t('collections.addNew')}
                      </Text>
                    </Pressable>
                  );
                }

                const option = item;
                const isSelected = selectedIds.has(option.id);
                return (
                  <Pressable
                    accessibilityLabel={option.name}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onToggle(option)}
                    style={viewMode === 'grid' ? styles.gridCell : styles.listCell}
                  >
                    <View style={styles.tileIconSlot}>
                      <CategoryIconTile collectionId={option.id} color={option.color} icon={option.icon} size={48} />
                      {isSelected ? (
                        <View style={styles.selectedBadge}>
                          <CheckIcon color={colors.surface} size={11} strokeWidth={3} />
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={[styles.tileLabel, viewMode === 'list' && styles.listLabel]}>
                      {option.name}
                    </Text>
                  </Pressable>
                );
              }}
              ListFooterComponent={
                isLoadingMore ? (
                  <View style={styles.footerLoading}>
                    <ActivityIndicator />
                  </View>
                ) : undefined
              }
              style={styles.optionList}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable accessibilityRole="button" disabled={isCreatingCollection} onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeLabel}>{t('common.close')}</Text>
          </Pressable>
        </Animated.View>
      </View>

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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  titleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  loading: {
    marginVertical: 20,
  },
  footerLoading: {
    paddingVertical: 12,
  },
  optionList: {
    maxHeight: 360,
    marginTop: spacing.sm,
  },
  // Each cell claims exactly 1/GRID_COLUMNS of the row's width - a plain percentage flexBasis
  // (not FlatList's columnWrapperStyle) so a short final row never stretches to fill the line,
  // matching the fixed-grid look this round's redesign calls for.
  gridCell: {
    alignItems: 'center',
    flexBasis: `${100 / GRID_COLUMNS}%`,
    paddingVertical: spacing.sm + 2,
  },
  listCell: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.xs },
  tileIconSlot: {
    position: 'relative',
  },
  createTile: {
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    borderRadius: radii.md + 6,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  // A small brand-filled circle badge at the tile's corner - never a full-tile background tint
  // (this round's explicit "row/tile 전체 background를 파랗게 칠하지 않는다" carry-over from the
  // Category selection redesign already shipped and device-verified).
  selectedBadge: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderColor: colors.surface,
    borderRadius: 9,
    borderWidth: 2,
    bottom: -2,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 18,
  },
  tileLabel: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: spacing.xs + 2,
    maxWidth: 76,
    textAlign: 'center',
  },
  listLabel: { flex: 1, maxWidth: undefined, textAlign: 'start' },
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
