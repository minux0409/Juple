import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { BellIcon } from '../icons/BellIcon';
import { BellOffIcon } from '../icons/BellOffIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { EditIcon } from '../icons/EditIcon';
import { LockIcon } from '../icons/LockIcon';
import { LogoutIcon } from '../icons/LogoutIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { StarIcon } from '../icons/StarIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UnlockIcon } from '../icons/UnlockIcon';
import { collectionShortcutService } from '../shortcuts/CollectionShortcutService';
import { getCollectionNotificationPreference, setCollectionNotificationPreference, type Collection } from './api/collectionsApi';
import { getCollectionCapabilities } from './collectionCapabilities';
import { isCollectionLocked } from './collectionAccess';

/** The Collection's own screen actions the list asks for (see RootStack's CollectionDetails.pendingAction). */
export type CollectionManagementAction = 'edit' | 'lock' | 'delete' | 'leave';

interface UseCollectionLongPressMenuOptions {
  /** The caller's own favorite mark - the list's existing toggle (optimistic, rolled back on failure). */
  readonly onToggleFavorite: (collection: Collection) => void;
  /** Opens the Collection's own screen with one of its dialogs: 수정, 잠금 설정, 삭제 (Owner) or 나가기 (member). */
  readonly onManage: (collection: Collection, action: CollectionManagementAction) => void;
}

const FilledStarIcon = (props: { readonly color?: string; readonly size?: number }) => <StarIcon {...props} filled />;

/**
 * The long-press menu of a Collection card (List and Grid), shared so no screen builds its own. What it offers follows the
 * caller's role (getCollectionCapabilities - the server stays the judge of every call):
 *   즐겨찾기 on/off, 새 링크 알림 on/off (where others can add links), 수정 and 잠금 설정 (Owner), 앱 바로가기 추가/제거,
 *   then ONE destructive row last - 삭제 for the Owner, 나가기 for a member, never both.
 * Each row reuses what already exists: the list's favorite toggle, the saved notification preference, and the Collection's
 * own screen for edit / lock / delete / leave (its dialogs, password prompt and undo) - nothing is rebuilt here. The
 * notification row appears once the caller's current setting is known (one small read when the menu opens), so its label
 * is never a guess.
 *
 * 홈 화면에 바로가기 추가 asks Android's own system dialog for a real 1x1 Home icon (CollectionShortcutService) - a device-local,
 * explicit choice. The same Collection also becomes a Direct Share destination once the launcher confirms the icon was added,
 * unless it is read-only or locked (a locked Collection still gets its icon; opening it still asks for the password). The row
 * that removes a Collection from the share targets only appears while it is one - Android cannot remove a Home icon, so no
 * row pretends to. At the platform limit the user is told and nothing already chosen is dropped.
 */
export function useCollectionLongPressMenu({ onToggleFavorite, onManage }: UseCollectionLongPressMenuOptions) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { showNotificationToast } = useAppToast();

  // The card the menu is for stays set while the menu fades out, so its rows never blank mid-fade; the Modal itself exists
  // only while open (and on iOS until it has finished closing) so a list of many cards carries no idle dialogs.
  const [target, setTarget] = useState<Collection | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isPinned, setIsPinned] = useState<boolean | null>(null);
  const [homeSupported, setHomeSupported] = useState<boolean | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const openMenu = useCallback((collection: Collection) => {
    const requestId = ++requestIdRef.current;
    setTarget(collection);
    setIsPinned(null);
    setHomeSupported(null);
    setNotificationsEnabled(null);
    setIsVisible(true);
    setIsMounted(true);

    collectionShortcutService.getPinnedCollectionIds()
      .then(ids => {
        if (requestIdRef.current === requestId) {
          setIsPinned(ids.has(collection.id));
        }
      })
      .catch(() => undefined);
    collectionShortcutService.isHomeShortcutSupported()
      .then(supported => {
        if (requestIdRef.current === requestId) {
          setHomeSupported(supported);
        }
      })
      .catch(() => undefined);

    if (getCollectionCapabilities(collection).canToggleNotification) {
      getCollectionNotificationPreference(request, collection.id)
        .then(preference => {
          if (requestIdRef.current === requestId) {
            setNotificationsEnabled(preference.newItemNotificationsEnabled);
          }
        })
        // Without the current setting the row is simply not offered - never a guessed label.
        .catch(() => undefined);
    }
  }, [request]);

  const closeMenu = () => {
    requestIdRef.current += 1;
    setIsVisible(false);
    if (Platform.OS !== 'ios') {
      setIsMounted(false);
    }
  };

  const changeNotifications = (collection: Collection, enabled: boolean) => {
    setCollectionNotificationPreference(request, collection.id, enabled).catch(() => {
      showNotificationToast(t('collections.newLinkNotificationsError'));
    });
  };

  const addHomeShortcut = async (collection: Collection) => {
    try {
      const outcome = await collectionShortcutService.requestHomeShortcut(collection);
      if (outcome.status === 'limit') {
        setMessage(t('collections.shortcutLimitReached', { count: outcome.max }));
      } else if (outcome.status === 'unsupported') {
        setMessage(t('collections.homeShortcutUnsupported'));
      } else if (outcome.lockedNotShared) {
        // The icon was asked for (opening it will still ask for the password); the user is told it is not a share target.
        setMessage(t('collections.homeShortcutLocked'));
      }
    } catch {
      setMessage(t('collections.homeShortcutUnsupported'));
    }
  };

  const removeFromShareTargets = async (collection: Collection) => {
    try {
      await collectionShortcutService.unpin(collection.id);
    } catch {
      setMessage(t('collections.errorMembershipFallback'));
    }
  };

  const buildActions = (collection: Collection): ActionMenuDialogAction[] => {
    const capabilities = getCollectionCapabilities(collection);
    const actions: ActionMenuDialogAction[] = [];

    if (capabilities.canToggleFavorite) {
      actions.push({
        label: collection.isFavorite ? t('collections.removeFavorite') : t('collections.addFavorite'),
        icon: collection.isFavorite ? FilledStarIcon : StarIcon,
        onPress: () => { closeMenu(); onToggleFavorite(collection); },
      });
    }
    if (capabilities.canToggleNotification && notificationsEnabled !== null) {
      actions.push({
        label: notificationsEnabled ? t('collections.newLinkNotificationsTurnOff') : t('collections.newLinkNotificationsTurnOn'),
        icon: notificationsEnabled ? BellOffIcon : BellIcon,
        onPress: () => { closeMenu(); changeNotifications(collection, !notificationsEnabled); },
      });
    }
    if (capabilities.canEdit) {
      actions.push({ label: t('common.edit'), icon: EditIcon, onPress: () => { closeMenu(); onManage(collection, 'edit'); } });
    }
    if (capabilities.canChangeLock) {
      actions.push({
        label: isCollectionLocked(collection) ? t('collections.lockRemoveAction') : t('collections.lockSetTitle'),
        icon: isCollectionLocked(collection) ? UnlockIcon : LockIcon,
        onPress: () => { closeMenu(); onManage(collection, 'lock'); },
      });
    }
    // A real Home-screen icon - any role, read-only included (it only opens the Collection). Shown once the launcher is known to support it.
    if (collectionShortcutService.isSupported() && homeSupported === true) {
      actions.push({
        label: t('collections.homeShortcutAdd'),
        icon: PlusIcon,
        onPress: () => { closeMenu(); addHomeShortcut(collection).catch(() => undefined); },
      });
    }
    // Only while it IS a Direct Share destination: takes it out of the share sheet. (A Home icon stays until the user deletes it.)
    if (collectionShortcutService.isSupported() && isPinned === true) {
      actions.push({
        label: t('collections.shortcutRemove'),
        icon: CloseIcon,
        onPress: () => { closeMenu(); removeFromShareTargets(collection).catch(() => undefined); },
      });
    }
    // The one destructive row, last: the Owner deletes, a member leaves - never both.
    if (capabilities.canDelete) {
      actions.push({ label: t('collections.delete'), destructive: true, icon: TrashIcon, onPress: () => { closeMenu(); onManage(collection, 'delete'); } });
    } else if (capabilities.canLeave) {
      actions.push({ label: t('collections.leaveAction'), destructive: true, icon: LogoutIcon, onPress: () => { closeMenu(); onManage(collection, 'leave'); } });
    }
    return actions;
  };

  const element = (
    <>
      {isMounted && target ? (
        <ActionMenuDialog
          actions={buildActions(target)}
          cancelLabel={t('common.cancel')}
          onCancel={closeMenu}
          onDismiss={() => setIsMounted(false)}
          title={target.name}
          visible={isVisible}
        />
      ) : null}
      {message !== null ? <ConfirmDialog confirmLabel={t('common.confirm')} destructive={false} message={message} onConfirm={() => setMessage(null)} title={t('common.notice')} visible /> : null}
    </>
  );

  return { openMenu, element } as const;
}
