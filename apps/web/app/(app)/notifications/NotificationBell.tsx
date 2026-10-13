'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { isSessionLost } from '../../../lib/authSession';
import { getUnreadCount, refreshUnreadCount, setUnreadCount, shouldAutoRefresh, subscribeUnreadCount } from '../../../lib/notificationState';
import { bellLabel, formatBadgeCount, GROUP_LABEL_KEYS, groupNotifications, notificationsPagePath, POPOVER_NOTIFICATION_LIMIT, type AppNotification, type NotificationsPage } from '../../../lib/notifications';
import { useSignedInApp } from '../AppRoot';
import { Glyph } from '../Glyph';
import { NotificationRow, NotificationSkeleton } from './NotificationRow';
import { useNotificationActions, type OpenOutcome } from './useNotificationActions';
import styles from '../app.module.css';

type PanelState = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly items: readonly AppNotification[] };

const getServerCount = () => null;

/** The bell's unread total (lib/notificationState.ts); null until first known. */
export function useUnreadCount(): number | null {
  return useSyncExternalStore(subscribeUnreadCount, getUnreadCount, getServerCount);
}

/**
 * The global 알림 bell (mobile NotificationBellButton) at the shell's top end, on every page: the unread total as a number (1-99, then
 * "99+"; the button's name says the full count). It opens a small panel with the newest notifications, 모두 읽음 and 모두 보기 (the
 * whole history, /notifications). The count is re-read when the app starts, when the window comes back and after a page change (at
 * most every 15 s - the Web has no live channel); signing out clears it.
 */
export function NotificationBell() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const { open: openNotification, readAll, fetchUnread } = useNotificationActions();
  const unread = useUnreadCount();
  const pathname = usePathname();
  // The page the panel was opened on: moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const isOpen = openOn === pathname;
  const [panel, setPanel] = useState<PanelState>({ kind: 'loading' });
  const [notice, setNotice] = useState<string | null>(null);
  const [loadToken, setLoadToken] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const headingId = useId();

  // The count: at start, on coming back to the window, after a page change - never on a timer.
  useEffect(() => {
    const refresh = () => {
      if (shouldAutoRefresh()) {
        void refreshUnreadCount(fetchUnread);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchUnread]);
  useEffect(() => {
    if (shouldAutoRefresh()) {
      void refreshUnreadCount(fetchUnread);
    }
  }, [fetchUnread, pathname]);

  // The panel's rows: the newest few, read again every time it opens.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    let ignore = false;
    api<NotificationsPage>({ path: notificationsPagePath({ limit: POPOVER_NOTIFICATION_LIMIT, locale }) }).then(
      page => {
        if (!ignore) {
          setPanel({ kind: 'loaded', items: page.items });
          setUnreadCount(page.unreadCount);
        }
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setPanel({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, isOpen, loadToken, locale, onSessionLost]);

  const close = useCallback((returnFocus: boolean) => {
    setOpenOn(null);
    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }, []);

  // Esc closes (focus back on the bell); a click outside closes.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [close, isOpen]);

  const setRows = useCallback((update: (previous: readonly AppNotification[]) => readonly AppNotification[]) => {
    setPanel(previous => (previous.kind === 'loaded' ? { kind: 'loaded', items: update(previous.items) } : previous));
  }, []);

  const showOutcome = (outcome: OpenOutcome) => {
    if (outcome === 'navigated') {
      setOpenOn(null);
    } else {
      setNotice(outcome === 'appOnly' ? dictionary.notificationsAppOnly : dictionary.notificationsUnavailable);
    }
  };

  const items = panel.kind === 'loaded' ? panel.items : [];
  const canReadAll = panel.kind === 'loaded' && ((unread ?? 0) > 0 || items.some(item => item.readAtUtc === null));

  return (
    <div className={styles.bellWrap} ref={wrapperRef}>
      <button
        aria-controls={isOpen ? panelId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={bellLabel(unread, dictionary)}
        className={styles.bellButton}
        onClick={() => {
          setNotice(null);
          if (isOpen) {
            setOpenOn(null);
          } else {
            setPanel({ kind: 'loading' });
            setOpenOn(pathname);
          }
        }}
        ref={buttonRef}
        type="button"
      >
        <Glyph name="Bell" size={22} />
        {unread && unread > 0 ? (
          <span aria-hidden className={styles.countBadge}>
            {formatBadgeCount(unread)}
          </span>
        ) : null}
      </button>
      {isOpen ? (
        <div aria-labelledby={headingId} className={styles.bellPanel} id={panelId} ref={panelRef} role="dialog" tabIndex={-1}>
          <div className={styles.bellPanelHeader}>
            <h2 className={styles.bellPanelTitle} id={headingId}>
              {dictionary.notificationsTitle}
            </h2>
            {canReadAll ? (
              <button
                className={styles.textAction}
                onClick={() => {
                  setNotice(null);
                  readAll(setRows).then(ok => {
                    if (!ok) {
                      setNotice(dictionary.notificationsReadAllFailed);
                    }
                  });
                }}
                type="button"
              >
                {dictionary.notificationsMarkAllRead}
              </button>
            ) : null}
          </div>
          {notice ? (
            <p className={styles.bellNotice} role="status">
              {notice}
            </p>
          ) : null}
          <div className={styles.bellPanelBody}>
            {panel.kind === 'loading' ? <NotificationSkeleton count={4} /> : null}
            {panel.kind === 'failed' ? (
              <div className={styles.bellEmpty} role="alert">
                <span className={styles.stateMessage}>{dictionary.loadFailedTitle}</span>
                <button className={styles.secondaryButton} onClick={() => {
                    setPanel({ kind: 'loading' });
                    setLoadToken(token => token + 1);
                  }} type="button">
                  {dictionary.notificationsRetry}
                </button>
              </div>
            ) : null}
            {panel.kind === 'loaded' && items.length === 0 ? <p className={styles.bellEmpty}>{dictionary.notificationsEmpty}</p> : null}
            {/* The same groups as the 알림 page and the mobile app (one helper, the viewer's local calendar), over the rows this panel
                loaded - only groups that have one. */}
            {groupNotifications(items).map(group => (
              <section aria-labelledby={`${headingId}-${group.key}`} className={styles.bellGroup} key={group.key}>
                <h3 className={styles.bellGroupHeading} id={`${headingId}-${group.key}`}>
                  {dictionary[GROUP_LABEL_KEYS[group.key]]}
                </h3>
                <ul className={styles.notificationList}>
                  {group.items.map(item => (
                    <li key={item.id}>
                      <NotificationRow
                        compact
                        dictionary={dictionary}
                        locale={locale}
                        notification={item}
                        onOpen={() => {
                          setNotice(null);
                          openNotification(item, setRows).then(showOutcome);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <Link className={styles.bellPanelFooter} href="/notifications" onClick={() => setOpenOn(null)}>
            {dictionary.notificationsSeeAll}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
