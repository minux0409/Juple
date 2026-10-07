import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { CategoryIconTile } from './CategoryIconTile';
import { contentGateOf, isCollaborative, isCollectionLocked } from './collectionAccess';
import { CollectionStatusBadges } from './CollectionStatusBadges';
import { CheckIcon } from '../icons/CheckIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { FolderPlusIcon } from '../icons/FolderPlusIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { useViewModePreference, type ViewModePreferenceKey } from '../settings/viewModePreference';
import type { Collection } from './api/collectionsApi';
import { LoadFailureState, type LoadFailureInfo } from '../components/LoadFailureState';
import { RefreshFailureNotice } from '../components/RefreshFailureNotice';
import { SheetHeader, type SheetDismissGesture } from '../components/sheetDismissGesture';

const GRID_COLUMNS = 4;

/** Stable sentinels for the leading special tiles - never a real Collection, so `'kind' in item` tells them apart. */
const CREATE_TILE = { kind: 'create' } as const;
const NONE_TILE = { kind: 'none' } as const;
type GridItem = typeof CREATE_TILE | typeof NONE_TILE | Collection;

export interface CollectionChoiceGridProps {
  readonly collectionPool: readonly Collection[];
  readonly selectedIds: ReadonlySet<number>;
  readonly onToggle: (collection: Collection) => void;
  readonly isLoadingOptions: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
  /** Defaults to 컬렉션 선택. */
  readonly title?: string;
  /** Where this chooser's own List/Grid choice is kept (so another chooser's choice is never overwritten). */
  readonly viewModeKey?: ViewModePreferenceKey;
  /** The leading "+ 새로 만들기" tile - on by default. */
  readonly showCreateTile?: boolean;
  readonly onOpenCreateDialog?: () => void;
  /** The create tile's label - defaults to "+ 새로 만들기". */
  readonly createLabel?: string;
  /** What a screen reader says for the create tile when its visible label is short ("추가"). */
  readonly createAccessibilityLabel?: string;
  /**
   * "선택 안 함" as the second tile, right after "+ 새로 만들기", in the same tile size: an explicit choice of no
   * Collection (the 링크 저장 screen). Absent = no such tile.
   */
  readonly noneTile?: { readonly label: string; readonly isSelected: boolean; readonly onPress: () => void };
  /** An order control (최신순 | 이름순) under the title; absent = none. */
  readonly sort?: { readonly value: 'newest' | 'title'; readonly onChange: (next: 'newest' | 'title') => void };
  /** Shown but not choosable, marked 이미 포함됨 (e.g. a Collection the link is already in). */
  readonly disabledIds?: ReadonlySet<number>;
  /**
   * The Collection list could not be loaded. Nothing listed yet: a centered load-failure state in place of the tiles.
   * Some already listed (a next page failed): they stay, with a compact non-blocking retry row.
   */
  readonly loadFailure?: LoadFailureInfo | null;
  readonly onRetryLoad?: () => void;
  /** The tile list's own size: the bottom sheet bounds it; a full screen lets it fill the room it has. */
  readonly listStyle?: StyleProp<ViewStyle>;
  /**
   * Inside a bottom sheet: the title row (title + List/Grid) goes under the shared handle as the sheet's drag area
   * (see SheetHeader / CategoryPickerModal). Absent: a plain title row.
   */
  readonly sheetHeader?: { readonly gesture: Pick<SheetDismissGesture, 'dragAreaHandlers'>; readonly style?: StyleProp<ViewStyle>; readonly testID?: string };
}

/**
 * The one "컬렉션 선택" chooser: a title with the List/Grid toggle, then the user's Collections as icon tiles (Grid) or
 * rows (List) - their own icon/photo, lock/shared markers and a check badge on each selected one - led by
 * "+ 새로 만들기" (and, where offered, "선택 안 함" right beside it). Shared by the bottom-sheet picker
 * (CategoryPickerModal - ItemDetails, 다른 컬렉션에 복제) and the full-screen 링크 저장 screen, so Juple never grows a
 * second Collection-list design. Selection itself stays with the caller (selectedIds / onToggle).
 */
export function CollectionChoiceGrid({
  collectionPool,
  selectedIds,
  onToggle,
  isLoadingOptions,
  isLoadingMore,
  onLoadMore,
  title,
  viewModeKey = 'categoryPickerViewMode',
  showCreateTile = true,
  onOpenCreateDialog = () => undefined,
  createLabel,
  createAccessibilityLabel,
  noneTile,
  sort,
  disabledIds,
  loadFailure = null,
  onRetryLoad,
  listStyle,
  sheetHeader,
}: CollectionChoiceGridProps) {
  const { t } = useTranslation();
  const { viewMode, changeViewMode } = useViewModePreference(viewModeKey, 'grid');
  const isGrid = viewMode === 'grid';

  const titleText = <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title ?? t('collections.selectTitle')}</Text>;
  const toggle = <ViewModeToggle onChange={changeViewMode} value={viewMode} />;

  const leading: GridItem[] = [];
  if (showCreateTile) {
    leading.push(CREATE_TILE);
  }
  if (noneTile) {
    leading.push(NONE_TILE);
  }
  const gridData: readonly GridItem[] = [...leading, ...collectionPool];

  const renderSpecial = (kind: 'create' | 'none') => {
    const isNone = kind === 'none';
    const isSelected = isNone && noneTile?.isSelected === true;
    const label = isNone ? noneTile?.label ?? '' : createLabel ?? t('collections.addNew');
    return (
      <Pressable
        accessibilityLabel={isNone ? label : createAccessibilityLabel ?? label}
        accessibilityRole="button"
        accessibilityState={isNone ? { selected: isSelected } : undefined}
        onPress={isNone ? noneTile?.onPress : onOpenCreateDialog}
        style={isGrid ? styles.gridCell : styles.listCell}
        testID={isNone ? 'category-picker-none' : 'category-picker-create'}
      >
        <View style={styles.tileIconSlot}>
          <View style={[styles.specialTile, isNone && styles.noneTile]}>
            {isNone ? <CloseIcon color={colors.textSecondary} size={22} strokeWidth={2} /> : <FolderPlusIcon color={colors.brand} size={24} strokeWidth={2} />}
          </View>
          {isSelected ? (
            <View style={styles.selectedBadge}>
              <CheckIcon color={colors.surface} size={11} strokeWidth={3} />
            </View>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.tileLabel, !isGrid && styles.listLabel]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <>
      {sheetHeader ? (
        <SheetHeader actions={toggle} gesture={sheetHeader.gesture} style={sheetHeader.style} testID={sheetHeader.testID} title={titleText} />
      ) : (
        <View style={styles.titleRow}>
          {titleText}
          {toggle}
        </View>
      )}
      {sort ? (
        <View accessibilityRole="radiogroup" style={styles.sortRow} testID="category-picker-sort">
          {(['newest', 'title'] as const).map(option => {
            const isSelected = sort.value === option;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                hitSlop={{ top: 8, bottom: 8 }}
                key={option}
                onPress={() => sort.onChange(option)}
                style={[styles.sortChip, isSelected && styles.sortChipSelected]}
                testID={`category-picker-sort-${option}`}
              >
                <Text numberOfLines={1} style={[styles.sortChipLabel, isSelected && styles.sortChipLabelSelected]}>
                  {option === 'newest' ? t('collections.sortRecent') : t('collections.sortName')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {isLoadingOptions ? (
        <ActivityIndicator style={styles.loading} testID="category-picker-loading" />
      ) : loadFailure && collectionPool.length === 0 ? (
        <LoadFailureState compact error={loadFailure.cause} notice={loadFailure.notice} onRetry={onRetryLoad} testID="category-picker-load-failure" />
      ) : (
        <FlatList
          key={viewMode}
          data={gridData}
          extraData={[selectedIds, noneTile?.isSelected]}
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => ('kind' in item ? item.kind : item.id.toString())}
          numColumns={isGrid ? GRID_COLUMNS : 1}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.5}
          renderItem={({ item }) => {
            if ('kind' in item) {
              return renderSpecial(item.kind);
            }

            const option = item;
            const isSelected = selectedIds.has(option.id);
            const isDisabled = disabledIds?.has(option.id) === true;
            // Touching a locked Collection asks for its password first - the caller's onToggle decides.
            const isLocked = contentGateOf(option) !== null;
            return (
              <Pressable
                accessibilityHint={isDisabled ? t('collections.alreadyIncluded') : isLocked ? t('collections.lockRequiredForAction') : undefined}
                accessibilityLabel={option.name}
                accessibilityRole="button"
                accessibilityState={isDisabled ? { selected: isSelected, disabled: true } : { selected: isSelected }}
                disabled={isDisabled || undefined}
                onPress={() => onToggle(option)}
                style={[isGrid ? styles.gridCell : styles.listCell, isDisabled && styles.disabledCell]}
                testID={`category-picker-option-${option.id}`}
              >
                <View style={styles.tileIconSlot}>
                  <CategoryIconTile collectionId={option.id} color={option.color} icon={option.icon} imageUrl={option.iconImageUrl} imageVersion={option.iconImageVersion} size={48} />
                  {/* Same start-side markers as the Categories screen, so a shared Category is recognizable here too. */}
                  <CollectionStatusBadges isLocked={isCollectionLocked(option)} isShared={isCollaborative(option)} size={18} />
                  {isSelected ? (
                    <View style={styles.selectedBadge}>
                      <CheckIcon color={colors.surface} size={11} strokeWidth={3} />
                    </View>
                  ) : null}
                </View>
                <View style={isGrid ? styles.gridText : styles.listText}>
                  <Text numberOfLines={1} style={[styles.tileLabel, !isGrid && styles.listLabel]}>
                    {option.name}
                  </Text>
                  {isDisabled ? (
                    <Text numberOfLines={1} style={[styles.disabledLabel, !isGrid && styles.listLabel]} testID={`category-picker-included-${option.id}`}>
                      {t('collections.alreadyIncluded')}
                    </Text>
                  ) : null}
                </View>
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
          style={[styles.optionList, listStyle]}
          testID="category-picker-list"
        />
      )}

      {loadFailure && collectionPool.length > 0 ? <RefreshFailureNotice onRetry={onRetryLoad} testID="category-picker-more-failure" /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 18, fontWeight: '700' },
  titleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  // The same order chips as a Collection's own 시간순 | 이름순.
  sortRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  sortChip: {
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
  },
  sortChipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  sortChipLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  sortChipLabelSelected: { color: colors.surface },
  loading: { marginVertical: 20 },
  footerLoading: { paddingVertical: 12 },
  optionList: { marginTop: spacing.sm },
  // Each cell claims exactly 1/GRID_COLUMNS of the row's width - a plain percentage flexBasis (not
  // columnWrapperStyle) so a short final row never stretches to fill the line.
  gridCell: { alignItems: 'center', flexBasis: `${100 / GRID_COLUMNS}%`, paddingVertical: spacing.sm + 2 },
  listCell: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingVertical: spacing.xs },
  tileIconSlot: { position: 'relative' },
  specialTile: { alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: radii.md + 6, height: 48, justifyContent: 'center', width: 48 },
  noneTile: { backgroundColor: colors.surfaceMuted },
  // A small brand-filled circle badge at the tile's corner - never a full-tile background tint.
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
  tileLabel: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: spacing.xs + 2, maxWidth: 76, textAlign: 'center' },
  listLabel: { maxWidth: undefined, textAlign: 'start' },
  gridText: { alignItems: 'center' },
  listText: { flex: 1, minWidth: 0 },
  disabledCell: { opacity: 0.45 },
  disabledLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 1, maxWidth: 76, textAlign: 'center' },
});
