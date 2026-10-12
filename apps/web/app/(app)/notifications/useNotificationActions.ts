'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { isSessionLost } from '../../../lib/authSession';
import { contentGateOf, isNotFound } from '../../../lib/collectionDetails';
import { unlockHeaders } from '../../../lib/collectionUnlock';
import { sharedItemPath } from '../../../lib/itemDetails';
import { adjustUnreadCount, getUnreadCount, refreshUnreadCount, setUnreadCount } from '../../../lib/notificationState';
import {
  collectionLinkHref,
  markAllRowsRead,
  markRowRead,
  notificationReadPath,
  parseNotificationTarget,
  READ_ALL_PATH,
  rollbackRowRead,
  UNREAD_COUNT_PATH,
  webDestinationOf,
  type AppNotification,
  type CollectionLinkProbe,
  type NotificationReadResult,
} from '../../../lib/notifications';
import { useSignedInApp } from '../AppRoot';

type Rows = readonly AppNotification[];
type SetRows = (update: (previous: Rows) => Rows) => void;

/** What opening a notification did: went somewhere, or stayed with a notice (the Web cannot show it / it is gone). */
export type OpenOutcome = 'navigated' | 'appOnly' | 'unavailable';

/**
 * Opening and reading notifications - one path for the bell's panel and the 알림 page (the mobile openNotification):
 *  1. an unread row is shown read at once and the bell drops by one; the server read follows - if it fails, the row is unread again
 *     and the bell is re-read from the server (never guessed);
 *  2. the server's target becomes a Web page (lib/notifications.ts webDestinationOf); a link in a Collection is opened through the
 *     Collection (its gate first); what the Web cannot show stays put with a notice.
 */
export function useNotificationActions() {
  const { api, onSessionLost } = useSignedInApp();
  const router = useRouter();

  const fetchUnread = useCallback(() => api<{ readonly totalUnread: number }>({ path: UNREAD_COUNT_PATH }).then(result => result.totalUnread), [api]);

  const open = useCallback(
    async (row: AppNotification, setRows: SetRows): Promise<OpenOutcome> => {
      if (row.readAtUtc === null) {
        setRows(previous => markRowRead(previous, row.id, new Date().toISOString()));
        adjustUnreadCount(-1);
        api<NotificationReadResult>({ method: 'POST', path: notificationReadPath(row.id) }).then(
          result => setUnreadCount(result.unreadCount),
          error => {
            if (isSessionLost(error)) {
              onSessionLost();
              return;
            }
            setRows(previous => rollbackRowRead(previous, row.id));
            void refreshUnreadCount(fetchUnread);
          },
        );
      }

      const destination = webDestinationOf(parseNotificationTarget(row.target));
      switch (destination.kind) {
        case 'href':
          router.push(destination.href);
          return 'navigated';
        case 'collectionLink': {
          // Reading the link IN its Collection checks the Collection's lock / share password first (no grant is held outside it).
          const probe: CollectionLinkProbe = await api({ path: sharedItemPath(destination.collectionId, destination.itemId), headers: unlockHeaders(destination.collectionId) }).then(
            () => 'open' as const,
            (error: unknown) => (contentGateOf(error) ? 'gated' : isNotFound(error) ? 'missing' : 'failed'),
          );
          router.push(collectionLinkHref(destination, probe));
          return 'navigated';
        }
        case 'appOnly':
          return 'appOnly';
        case 'unavailable':
          return 'unavailable';
      }
    },
    [api, fetchUnread, onSessionLost, router],
  );

  /** 모두 읽음: every loaded row and the bell at once; a failure puts both back (then re-reads the bell) and reports false. */
  const readAll = useCallback(
    async (setRows: SetRows): Promise<boolean> => {
      let snapshot: Rows | null = null;
      setRows(previous => {
        snapshot = previous;
        return markAllRowsRead(previous, new Date().toISOString());
      });
      const countBefore = getUnreadCount();
      setUnreadCount(0);
      try {
        const result = await api<NotificationReadResult>({ method: 'POST', path: READ_ALL_PATH });
        setUnreadCount(result.unreadCount);
        return true;
      } catch (error) {
        if (isSessionLost(error)) {
          onSessionLost();
          return false;
        }
        const restored = snapshot;
        if (restored !== null) {
          setRows(() => restored);
        }
        if (countBefore !== null) {
          setUnreadCount(countBefore);
        }
        void refreshUnreadCount(fetchUnread);
        return false;
      }
    },
    [api, fetchUnread, onSessionLost],
  );

  return { open, readAll, fetchUnread };
}
