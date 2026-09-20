import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CategoryIconTile } from './CategoryIconTile';
import { colors, radii, spacing } from '../theme/tokens';
import type { Collection } from './api/collectionsApi';

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
  readonly newCollectionName: string;
  readonly onChangeNewCollectionName: (value: string) => void;
  readonly isCreatingCollection: boolean;
  readonly onSubmitNewCollection: () => void;
  /** Only needed so the sheet can pad its own bottom past the system nav bar - each caller already
   * has this from its own useSafeAreaInsets() call, so it isn't duplicated here. */
  readonly bottomInset: number;
}

/**
 * The "카테고리 선택" bottom-sheet modal: existing categories in a scrollable list with a
 * selected/unselected toggle per row, plus a "new category" name field + create button below it -
 * shared verbatim by ItemDetailsScreen and NewLinkReviewScreen (this round's explicit
 * requirement), extracted from ItemDetailsScreen's previous inline implementation with no visual
 * or behavioral change there. Selection itself (`selectedIds`/`onToggle`) stays screen-owned - see
 * useCategoryPickerModal.ts's own remarks on why.
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
  newCollectionName,
  onChangeNewCollectionName,
  isCreatingCollection,
  onSubmitNewCollection,
  bottomInset,
}: CategoryPickerModalProps) {
  const { t } = useTranslation();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <View style={[styles.content, { paddingBottom: 24 + bottomInset }]}>
          <Text style={styles.title}>{t('collections.selectTitle')}</Text>

          {isLoadingOptions ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <FlatList
              data={collectionPool}
              extraData={selectedIds}
              keyExtractor={option => option.id.toString()}
              onEndReached={onLoadMore}
              onEndReachedThreshold={0.5}
              ListEmptyComponent={<Text style={styles.empty}>{t('collections.addModalEmpty')}</Text>}
              renderItem={({ item: option }) => {
                const isSelected = selectedIds.has(option.id);
                return (
                  <Pressable
                    accessibilityLabel={option.name}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => onToggle(option)}
                    style={styles.optionRow}
                  >
                    <View style={styles.optionLabelRow}>
                      <CategoryIconTile collectionId={option.id} icon={option.icon} size={36} />
                      <Text numberOfLines={1} style={styles.optionLabel}>
                        {option.name}
                      </Text>
                    </View>
                    <View style={[styles.optionCheckCircle, isSelected && styles.optionCheckCircleSelected]}>
                      {isSelected ? <Text style={styles.optionCheckMark}>✓</Text> : null}
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
              style={styles.optionList}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.newCategoryLabel}>{t('collections.create')}</Text>
          <View style={styles.newCategoryRow}>
            <TextInput
              editable={!isCreatingCollection}
              onChangeText={onChangeNewCollectionName}
              placeholder={t('collections.namePlaceholder')}
              style={styles.newCategoryInput}
              value={newCollectionName}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{
                disabled: !newCollectionName.trim() || isCreatingCollection,
                busy: isCreatingCollection,
              }}
              disabled={!newCollectionName.trim() || isCreatingCollection}
              onPress={onSubmitNewCollection}
              style={[
                styles.newCategoryButton,
                (!newCollectionName.trim() || isCreatingCollection) && styles.disabledButton,
              ]}
            >
              <Text style={styles.newCategoryButtonLabel}>{t('collections.create')}</Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" disabled={isCreatingCollection} onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeLabel}>{t('common.close')}</Text>
          </Pressable>
        </View>
      </View>
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
  loading: {
    marginVertical: 20,
  },
  footerLoading: {
    paddingVertical: 12,
  },
  optionList: {
    maxHeight: 260,
  },
  optionRow: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  optionLabelRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginEnd: spacing.md,
  },
  optionLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
  },
  // A check-circle (empty outline when unselected, filled brand-colored circle with a white
  // checkmark when selected) - reads as an intentional selection control, not an accidental
  // disabled-row state.
  optionCheckCircle: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  optionCheckCircleSelected: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  optionCheckMark: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
  newCategoryLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  newCategoryRow: {
    flexDirection: 'row',
  },
  newCategoryInput: {
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    fontSize: 15,
    marginEnd: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  newCategoryButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
  newCategoryButtonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    color: '#666666',
    fontSize: 14,
    paddingVertical: 16,
  },
  closeButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: 20,
    paddingVertical: 12,
  },
  closeLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
