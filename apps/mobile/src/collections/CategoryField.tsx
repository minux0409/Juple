import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { EditIcon } from '../icons/EditIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import type { Collection } from './api/collectionsApi';

/** How many selected-category chips the compact summary row shows before collapsing the rest into a "+N" chip. */
const CATEGORY_SUMMARY_MAX_CHIPS = 3;

interface CategoryFieldProps {
  readonly selectedCollections: readonly Collection[];
  readonly isLoading: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
  readonly onPress: () => void;
}

/**
 * The "카테고리" labeled field - label, compact selected-category summary row (at most
 * CATEGORY_SUMMARY_MAX_CHIPS chips + a "+N" chip for the rest, or an empty-state sentence), and an
 * inline error - shared verbatim by ItemDetailsScreen and NewLinkReviewScreen so both screens show
 * and behave identically here (this round's explicit requirement). Tapping anywhere in the row
 * opens the picker modal (see CategoryPickerModal.tsx) - this component has no notion of the modal
 * itself, only `onPress`, which keeps this screen's own height independent of how many categories
 * exist or are selected.
 */
export function CategoryField({ selectedCollections, isLoading, disabled, error, onPress }: CategoryFieldProps) {
  const { t } = useTranslation();

  return (
    <>
      <Text style={styles.label}>{t('collections.itemSectionTitle')}</Text>
      {isLoading ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <Pressable
          accessibilityLabel={t('item.categoryEditA11y')}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled) }}
          disabled={disabled}
          onPress={onPress}
          style={styles.row}
        >
          <View style={styles.chips}>
            {selectedCollections.length === 0 ? (
              <Text style={styles.empty}>{t('collections.itemSectionEmpty')}</Text>
            ) : (
              <>
                {selectedCollections.slice(0, CATEGORY_SUMMARY_MAX_CHIPS).map(option => (
                  <View key={option.id} style={styles.chip}>
                    <Text numberOfLines={1} style={styles.chipLabel}>
                      {option.name}
                    </Text>
                  </View>
                ))}
                {selectedCollections.length > CATEGORY_SUMMARY_MAX_CHIPS ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipLabel}>
                      {`+${selectedCollections.length - CATEGORY_SUMMARY_MAX_CHIPS}`}
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
          <View style={styles.iconButton}>
            <EditIcon color={colors.textPrimary} size={20} />
          </View>
        </Pressable>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 6,
  },
  loading: {
    marginTop: 8,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginEnd: 12,
  },
  chip: {
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    // Caps a single chip's width so one long category name can never push the "+N" chip or the
    // edit icon off-screen - it truncates with an ellipsis (numberOfLines=1) instead.
    maxWidth: 140,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipLabel: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    marginTop: spacing.md,
  },
});
