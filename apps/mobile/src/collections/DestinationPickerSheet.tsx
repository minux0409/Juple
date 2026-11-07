import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryPickerModal } from './CategoryPickerModal';
import type { UseCollectionDestinationPickerResult } from './useCollectionDestinationPicker';

interface DestinationPickerSheetProps {
  readonly picker: UseCollectionDestinationPickerResult;
  readonly title: string;
  /** The submit button's label (it already carries a count where the action wants one). */
  readonly submitLabel: string;
}

/**
 * The Collection destination chooser (List/Grid, order, one or several destinations, "+ 새 컬렉션 만들기", a locked Collection's
 * password) wired to a useCollectionDestinationPicker - the same sheet Collection Details uses for 복제 / 복사 / 이동, for the screens
 * whose bulk actions pick a destination (Home / Archive 컬렉션 변경).
 */
export function DestinationPickerSheet({ picker, title, submitLabel }: DestinationPickerSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <CategoryPickerModal
      bottomInset={insets.bottom}
      collectionPool={picker.collections}
      createAccessibilityLabel={t('collections.copyCreateNew')}
      createError={picker.createError}
      createLabel={t('collections.addTile')}
      disabledIds={picker.disabledIds}
      error={picker.error}
      isCreateDialogVisible={picker.isCreateDialogVisible}
      isCreatingCollection={picker.isCreating}
      isLoadingMore={picker.isLoadingMore}
      isLoadingOptions={picker.isLoading}
      loadFailure={picker.loadFailure}
      onClose={picker.close}
      onCloseCreateDialog={picker.closeCreateDialog}
      onCreateCollection={picker.submitNewCollection}
      onLoadMore={picker.loadMore}
      onOpenCreateDialog={picker.openCreateDialog}
      onRetryLoad={picker.retryLoad}
      onToggle={picker.toggle}
      onUnlockCancel={picker.cancelUnlock}
      onUnlockGranted={picker.onUnlockGranted}
      onUnlockStateChanged={picker.onUnlockStateChanged}
      selectedIds={picker.selectedIds}
      sort={{ value: picker.sort, onChange: picker.changeSort }}
      submit={{ label: submitLabel, onSubmit: picker.submit, isSubmitting: picker.isSubmitting }}
      title={title}
      unlockTarget={picker.unlockTarget}
      viewModeKey="replicatePickerViewMode"
      visible={picker.isVisible}
    />
  );
}
