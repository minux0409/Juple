import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { useActionAfterMenu } from '../components/useActionAfterMenu';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useItemCollectionChange } from '../collections/useItemCollectionChange';
import { EditIcon } from '../icons/EditIcon';
import { ExternalLinkIcon } from '../icons/ExternalLinkIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { TrashIcon } from '../icons/TrashIcon';
import type { ItemHistoryEntry } from './api/itemsApi';

/** What the menu needs of a link card - Home and History pass their ItemHistoryEntry as is. */
export type SavedLinkActionTarget = Pick<ItemHistoryEntry, 'id' | 'url' | 'collectionId'> & {
  /** A link of a locked Collection (redacted by the server): it has no menu at all. */
  readonly isCollectionLocked?: boolean;
};

interface UseSavedLinkActionsOptions {
  /** 수정: the same Item Details a tap opens (title and memo are edited there). */
  readonly onEdit: (item: SavedLinkActionTarget) => void;
  /** 삭제: the screen's own confirmation and delete (never run here). */
  readonly onDelete: (item: SavedLinkActionTarget) => void;
  /** A link's Collections changed: the screen refreshes what it shows. */
  readonly onCollectionsChanged: () => void;
}

/** A link card has a menu unless the server redacted it. */
export function hasSavedLinkMenu(item: Pick<SavedLinkActionTarget, 'isCollectionLocked'>): boolean {
  return item.isCollectionLocked !== true;
}

/**
 * The long-press menu of a saved link card, shared by Home and History (List and Grid) so no screen builds its own:
 * 링크 열기, 수정, 컬렉션 변경, then 삭제 last (destructive). Each action reuses what already exists - the browser,
 * Item Details, the Collection picker with 컬렉션 없음 (useItemCollectionChange) and the screen's delete confirmation.
 * Opening the menu is the card's `onLongPress` (SwipeableItemRow); the card's tap, horizontal swipe and the list's
 * scroll are untouched, and a swipe or scroll cancels a pending long-press the way React Native's Pressable always does.
 */
export function useSavedLinkActions({ onEdit, onDelete, onCollectionsChanged }: UseSavedLinkActionsOptions) {
  const { t } = useTranslation();
  // The card the menu is for stays set while the menu fades out, so its rows never blank mid-fade.
  const [target, setTarget] = useState<SavedLinkActionTarget | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  // The menu's Modal exists only while it is open (and, on iOS, until it has finished closing - see useActionAfterMenu),
  // so a screen with many cards carries no idle dialogs.
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { afterMenuCloses, onMenuDismiss } = useActionAfterMenu();
  const collectionChange = useItemCollectionChange(onCollectionsChanged);

  const openMenu = useCallback((item: SavedLinkActionTarget) => {
    if (hasSavedLinkMenu(item)) {
      setTarget(item);
      setIsMenuVisible(true);
      setIsMenuMounted(true);
    }
  }, []);

  const closeMenu = () => {
    setIsMenuVisible(false);
    if (Platform.OS !== 'ios') {
      setIsMenuMounted(false);
    }
  };

  const openLink = async (item: SavedLinkActionTarget) => {
    // No Linking.canOpenURL pre-check - see ItemDetailsScreen.openOriginalUrl (Android package visibility).
    try {
      await Linking.openURL(item.url);
    } catch {
      setMessage(t('item.urlOpenFailed'));
    }
  };

  const actions: ActionMenuDialogAction[] = target
    ? [
        { label: t('item.goToUrlA11y'), icon: ExternalLinkIcon, onPress: () => { closeMenu(); openLink(target).catch(() => undefined); } },
        { label: t('common.edit'), icon: EditIcon, onPress: () => { closeMenu(); onEdit(target); } },
        { label: t('collections.changeCollection'), icon: FolderIcon, onPress: () => afterMenuCloses(closeMenu, () => { collectionChange.start(target.id).catch(() => undefined); }) },
        { label: t('common.delete'), destructive: true, icon: TrashIcon, onPress: () => afterMenuCloses(closeMenu, () => onDelete(target)) },
      ]
    : [];

  const element = (
    <>
      {isMenuMounted ? (
        <ActionMenuDialog
          actions={actions}
          cancelLabel={t('common.cancel')}
          onCancel={closeMenu}
          onDismiss={() => { setIsMenuMounted(false); onMenuDismiss(); }}
          visible={isMenuVisible}
        />
      ) : null}
      {collectionChange.element}
      {message !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={message} onConfirm={() => setMessage(null)} title={t('common.notice')} visible /> : null}
    </>
  );

  /** The row/tile props that wire a card to this menu: nothing for a redacted (locked) card. */
  const menuProps = (item: SavedLinkActionTarget) => ({ onLongPress: hasSavedLinkMenu(item) ? () => openMenu(item) : undefined });

  return { openMenu, menuProps, element } as const;
}
