import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CategoryPickerModal } from './CategoryPickerModal';
import type { Collection } from './api/collectionsApi';
import {
  applyItemMembershipChanges,
  clearItemCollectionSelection,
  getItemCollectionsListErrorMessage,
  isRemovalOwnerOnly,
  loadItemMemberships,
} from './itemMemberships';
import { formatSaveOutcomeMessage } from './saveOutcomeMessage';
import { useCategoryPickerModal } from './useCategoryPickerModal';

/**
 * 컬렉션 변경, from a link card's long-press menu: the SAME picker Item Details uses (CategoryPickerModal - with its
 * 컬렉션 없음 tile, per-Collection password asks and 새로 만들기), the same membership calls and the same messages
 * (itemMemberships.ts). Where Item Details stages the choice and saves it with the rest of the screen, this one saves it
 * with 저장 in the sheet. The link itself - URL, title, memo, photos, times, owner - is never touched: only which
 * Collections it is in changes, and "컬렉션 없음" is simply no membership at all. The server stays the judge of every call.
 *
 * Item Details uses this same hook (handing over the memberships it already loaded, so nothing is fetched twice): its
 * Collection choice is saved HERE, with 저장 in the sheet, and is no longer part of the screen's own Save.
 */
export function useItemCollectionChange(onChanged: () => void) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const insets = useSafeAreaInsets();
  const { showNotificationToast } = useAppToast();
  // Idle, this hook mounts nothing: the sheet and the notice exist only while a change is in progress.
  const [message, setMessage] = useState<{ readonly title: string; readonly text: string } | null>(null);
  const showMessage = useCallback((text: string, options: { readonly title?: string } = {}) => {
    setMessage({ title: options.title ?? t('common.notice'), text });
  }, [t]);

  const [itemId, setItemId] = useState<number | null>(null);
  const [selected, setSelected] = useState<readonly Collection[]>([]);
  const [original, setOriginal] = useState<ReadonlySet<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const requestIdRef = useRef(0);

  const stageAdd = useCallback((option: Collection) => {
    setSelected(previous => (previous.some(existing => existing.id === option.id) ? previous : [...previous, option]));
  }, []);
  const stageRemove = useCallback((collectionId: number) => {
    setSelected(previous => previous.filter(option => option.id !== collectionId));
  }, []);

  const picker = useCategoryPickerModal(request, t, stageAdd);

  const selectedIds = new Set(selected.map(option => option.id));
  const isDirty = selected.length !== original.size || selected.some(option => !original.has(option.id));

  const start = useCallback(async (targetItemId: number, knownMemberships?: readonly Collection[]) => {
    const requestId = ++requestIdRef.current;
    setItemId(targetItemId);
    if (knownMemberships) {
      // The caller already holds the current memberships: no second fetch.
      setSelected(knownMemberships);
      setOriginal(new Set(knownMemberships.map(option => option.id)));
      picker.open();
      return;
    }
    setSelected([]);
    setOriginal(new Set());
    try {
      const memberships = await loadItemMemberships(request, targetItemId, () => requestIdRef.current !== requestId);
      if (memberships === null) {
        return;
      }
      setSelected(memberships);
      setOriginal(new Set(memberships.map(option => option.id)));
      picker.open();
    } catch (caughtError) {
      setItemId(null);
      showMessage(getItemCollectionsListErrorMessage(caughtError, t));
    }
    // picker.open is recreated every render; the request and t are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, showMessage, t]);

  const close = () => {
    if (isSaving) {
      return;
    }
    requestIdRef.current += 1;
    picker.close();
    setItemId(null);
  };

  const save = async () => {
    if (itemId === null || isSaving || !isDirty) {
      return;
    }
    setIsSaving(true);
    const toAdd = selected.filter(option => !original.has(option.id));
    const toRemoveIds = [...original].filter(id => !selectedIds.has(id));
    const result = await applyItemMembershipChanges(request, itemId, toAdd, toRemoveIds, picker.unlockTokenFor, t);
    setIsSaving(false);
    const failureText = result.failureMessages.join('\n');
    const changedAnything = result.addedIds.length + result.proposedIds.length + result.removedIds.length > 0;
    if (changedAnything) {
      onChanged();
    }
    if (result.proposedIds.length > 0) {
      const outcome = formatSaveOutcomeMessage({ added: result.addedIds.length, submitted: result.proposedIds.length }, t);
      closeAfterSave();
      showMessage(failureText ? `${outcome}\n\n${failureText}` : outcome, { title: t('collections.saveOutcomeTitle') });
    } else if (failureText) {
      // What went through stays; the sheet stays too, showing the choice as it now is, so the rest can be retried.
      setOriginal(previous => {
        const next = new Set(previous);
        result.addedIds.forEach(id => next.add(id));
        result.removedIds.forEach(id => next.delete(id));
        return next;
      });
      showMessage(failureText);
    } else {
      closeAfterSave();
      showNotificationToast(t('item.saved'));
    }
  };

  const closeAfterSave = () => {
    requestIdRef.current += 1;
    picker.close();
    setItemId(null);
  };

  const element = (
    <>
      {itemId !== null ? <CategoryPickerModal
        bottomInset={insets.bottom}
        collectionPool={picker.collectionPool}
        createError={picker.createError}
        error={picker.error}
        isCreateDialogVisible={picker.isCreateDialogVisible}
        isCreatingCollection={picker.isCreatingCollection}
        isLoadingMore={picker.isLoadingMore}
        isLoadingOptions={picker.isLoadingOptions}
        loadFailure={picker.loadFailure}
        noneTile={{
          label: t('collections.noCollection'),
          isSelected: selected.length === 0,
          onPress: () => clearItemCollectionSelection(
            selected,
            original,
            picker.requestToggle,
            stageRemove,
            () => showNotificationToast(t('collections.removeFromSharedOwnerOnly')),
          ),
        }}
        onClose={close}
        onCloseCreateDialog={picker.closeCreateDialog}
        onCreateCollection={picker.submitNewCollection}
        onLoadMore={picker.loadMore}
        onOpenCreateDialog={picker.openCreateDialog}
        onRetryLoad={picker.retryLoad}
        onToggle={option => {
          // Same rule as Item Details: only an Owner takes a link out of a Collection that is shared with me.
          if (selectedIds.has(option.id) && original.has(option.id) && isRemovalOwnerOnly(option)) {
            showNotificationToast(t('collections.removeFromSharedOwnerOnly'));
            return;
          }
          picker.requestToggle(option, () => (selectedIds.has(option.id) ? stageRemove(option.id) : stageAdd(option)));
        }}
        onUnlockCancel={picker.cancelUnlock}
        onUnlockGranted={picker.onUnlockGranted}
        onUnlockStateChanged={picker.onUnlockStateChanged}
        selectedIds={selectedIds}
        submit={{ label: t('common.save'), onSubmit: () => { save().catch(() => undefined); }, isSubmitting: isSaving, enabled: isDirty }}
        title={t('collections.changeCollection')}
        unlockTarget={picker.unlockTarget}
        visible={picker.isVisible}
      /> : null}
      {message !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={message.text} onConfirm={() => setMessage(null)} title={message.title} visible /> : null}
    </>
  );

  // True while the sheet, its create dialog or a password ask is up - a host screen keeps its own keyboard handling out of it.
  const isDialogOpen = itemId !== null && (picker.isVisible || picker.isCreateDialogVisible || picker.unlockTarget !== null);

  return { start, element, isDialogOpen } as const;
}
