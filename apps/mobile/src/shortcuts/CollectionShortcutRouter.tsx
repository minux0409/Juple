import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { getCollection } from '../collections/api/collectionsApi';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { navigationRef } from '../navigation/navigationRef';
import { collectionShortcutService } from './CollectionShortcutService';
import { iosCollectionShortcuts } from './iosCollectionShortcuts';
import { consumeShortcutLaunch, subscribeShortcutLaunch } from './shortcutLaunchSource';
import {
  isShortcutNoticeCode,
  SHORTCUT_NOTICE_OPEN_UNAVAILABLE,
  shortcutNoticeMessageKey,
  type ShortcutNoticeCode,
} from './shortcutLaunchNotice';

/**
 * Headless-ish (renders only a message when there is one), mounted once the app's navigation is up, next to
 * IncomingShareRouter. It is the app's side of the OS hand-offs (see shortcutLaunchSource: Android's
 * NativeIncomingShare.consumeShortcutLaunch, iOS's "컬렉션 열기" shortcut), checked on mount, every time the app comes to the
 * front, and (iOS) when a shortcut run leaves a launch while the app is already running. Mounted only when signed in, so a
 * launch left while signed out waits until after sign-in:
 * - a launcher shortcut tap (the Home-screen icon or a launcher-menu entry): open that Collection. The id came from an Intent,
 *   so it is NOT trusted - the Collection is read from the backend with the CURRENT signed-in account first, so another
 *   account's icon, a deleted Collection or lost access all end the same safe way: the share target is removed, the user is
 *   told (the Home icon itself can only be deleted by the user), and nothing opens. A Collection that is now locked still opens: its own screen asks for the
 *   password, exactly as when opened from the list.
 * - a notice the share path left (a Direct Share row whose Collection is no longer available, a link saved without its
 *   Collection): shown once in the shared message dialog.
 */
export function CollectionShortcutRouter() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const [notice, setNotice] = useState<ShortcutNoticeCode | null>(null);

  const openCollection = useCallback(async (collectionId: number) => {
    try {
      await getCollection(request, collectionId);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && (caughtError.kind === 'notFound' || caughtError.kind === 'forbidden')) {
        collectionShortcutService.unpin(collectionId).catch(() => undefined);
        iosCollectionShortcuts.remove(collectionId).catch(() => undefined);
        setNotice(SHORTCUT_NOTICE_OPEN_UNAVAILABLE);
        return;
      }
      // Offline or a server hiccup: the Collection's own screen shows the load failure with its retry.
    }
    if (!navigationRef.isReady()) {
      return;
    }
    // Already looking at it (a second tap, or a warm resume onto the same Collection): no second screen on top of itself.
    const current = navigationRef.getCurrentRoute();
    if (current?.name === 'CollectionDetails' && (current.params as { collectionId?: number } | undefined)?.collectionId === collectionId) {
      return;
    }
    navigationRef.navigate('CollectionDetails', { collectionId });
  }, [request]);

  const consume = useCallback(async () => {
    const launch = await consumeShortcutLaunch();
    if (!launch) {
      return;
    }
    if (isShortcutNoticeCode(launch.notice)) {
      setNotice(launch.notice);
    }
    if (launch.openCollectionId !== null) {
      await openCollection(launch.openCollectionId);
    }
  }, [openCollection]);

  useEffect(() => {
    consume().catch(() => undefined);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        consume().catch(() => undefined);
      }
    });
    // iOS: an "컬렉션 열기" run may leave its launch after the app is already in front.
    const unsubscribeLaunch = subscribeShortcutLaunch(() => {
      consume().catch(() => undefined);
    });
    return () => {
      subscription.remove();
      unsubscribeLaunch();
    };
  }, [consume]);

  return notice !== null ? (
    <ConfirmDialog
      confirmLabel={t('common.confirm')}
      destructive={false}
      message={t(shortcutNoticeMessageKey(notice))}
      onConfirm={() => setNotice(null)}
      title={t('common.notice')}
      visible
    />
  ) : null;
}
