'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSessionLost } from '../../../lib/authSession';
import { setUnreadCount } from '../../../lib/notificationState';
import { GROUP_LABEL_KEYS, groupNotifications, NOTIFICATIONS_PAGE_SIZE, notificationsPagePath, type AppNotification, type NotificationsPage } from '../../../lib/notifications';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../lib/paging';
import { useSignedInApp } from '../AppRoot';
import { Glyph } from '../Glyph';
import { LoadMore } from '../InfiniteScroll';
import { LoadFailed } from '../PageStates';
import { useRefreshOnUnreadRise, useUnreadCount } from './NotificationBell';
import { NotificationRow, NotificationSkeleton } from './NotificationRow';
import { useNotificationActions, type OpenOutcome } from './useNotificationActions';
import { PageHeader } from '../PageHeader';
import styles from '../app.module.css';

type State = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'loaded'; readonly paged: PagedState<AppNotification> };

/**
 * 알림 - the whole history (mobile NotificationsScreen): grouped by when they arrived (오늘 / 어제 / 최근 7일 / 최근 30일 / 이전 알림, by
 * the viewer's local calendar), newest first, older pages by the server's keyset cursor as the list scrolls (never a duplicate row,
 * one page at a time, a failed page keeps what is shown and offers a retry). A row opens through the shared path
 * (useNotificationActions); 모두 읽음 is offered while something is unread.
 */
export function NotificationsView() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const { open, readAll } = useNotificationActions();
  const unread = useUnreadCount();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const reloadList = useCallback(() => setReloadToken(token => token + 1), []);
  useRefreshOnUnreadRise(true, reloadList);
  const [notice, setNotice] = useState<{ readonly text: string; readonly error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    api<NotificationsPage>({ path: notificationsPagePath({ limit: NOTIFICATIONS_PAGE_SIZE, locale }) }).then(
      page => {
        if (!ignore) {
          setState({ kind: 'loaded', paged: firstPage(page.items, page.nextCursor) });
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
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, locale, onSessionLost, reloadToken]);

  const setRows = useCallback((update: (previous: readonly AppNotification[]) => readonly AppNotification[]) => {
    setState(previous => (previous.kind === 'loaded' ? { kind: 'loaded', paged: { ...previous.paged, items: update(previous.paged.items) } } : previous));
  }, []);

  const loadMore = () => {
    if (state.kind !== 'loaded' || !canLoadMore(state.paged)) {
      return;
    }
    const cursor = state.paged.nextCursor;
    setState({ kind: 'loaded', paged: startLoadingMore(state.paged) });
    api<NotificationsPage>({ path: notificationsPagePath({ cursor, limit: NOTIFICATIONS_PAGE_SIZE, locale }) }).then(
      page => {
        setState(previous => (previous.kind === 'loaded' ? { kind: 'loaded', paged: appendPage(previous.paged, page, item => item.id) } : previous));
        setUnreadCount(page.unreadCount);
      },
      error => {
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setState(previous => (previous.kind === 'loaded' ? { kind: 'loaded', paged: failLoadingMore(previous.paged) } : previous));
      },
    );
  };

  const showOutcome = (outcome: OpenOutcome) => {
    if (outcome !== 'navigated') {
      setNotice({ text: outcome === 'appOnly' ? dictionary.notificationsAppOnly : dictionary.notificationsUnavailable, error: false });
    }
  };

  const items = state.kind === 'loaded' ? state.paged.items : [];
  const canReadAll = state.kind === 'loaded' && ((unread ?? 0) > 0 || items.some(item => item.readAtUtc === null));

  return (
    <section aria-busy={state.kind === 'loading'} className={styles.page}>
      <PageHeader
        actions={
          canReadAll ? (
            <button
              className={styles.settingsAction}
              onClick={() => {
                setNotice(null);
                readAll(setRows).then(ok => {
                  if (!ok) {
                    setNotice({ text: dictionary.notificationsReadAllFailed, error: true });
                  }
                });
              }}
              type="button"
            >
              {dictionary.notificationsMarkAllRead}
            </button>
          ) : null
        }
        icon="Bell"
        title={dictionary.notificationsTitle}
      />
      <div className={styles.notificationsPage}>
        {notice ? (
          <p className={notice.error ? styles.fieldError : styles.formNotice} role={notice.error ? 'alert' : 'status'}>
            {notice.text}
          </p>
        ) : null}
        {state.kind === 'loading' ? <NotificationSkeleton count={6} /> : null}
        {state.kind === 'failed' ? (
          <LoadFailed
            dictionary={dictionary}
            onRetry={() => {
              setState({ kind: 'loading' });
              setReloadToken(token => token + 1);
            }}
          />
        ) : null}
        {state.kind === 'loaded' && items.length === 0 ? (
          <div className={styles.notificationsEmpty}>
            <span aria-hidden className={styles.notificationGlyph}>
              <Glyph name="Bell" size={22} />
            </span>
            <p className={styles.stateMessage}>{dictionary.notificationsEmpty}</p>
          </div>
        ) : null}
        {state.kind === 'loaded' && items.length > 0 ? (
          <>
            {groupNotifications(items).map(group => (
              <section aria-labelledby={`notifications-${group.key}`} className={styles.notificationGroup} key={group.key}>
                <h2 className={styles.settingsHeading} id={`notifications-${group.key}`}>
                  {dictionary[GROUP_LABEL_KEYS[group.key]]}
                </h2>
                <ul className={styles.notificationCard}>
                  {group.items.map(item => (
                    <li key={item.id}>
                      <NotificationRow
                        dictionary={dictionary}
                        locale={locale}
                        notification={item}
                        onOpen={() => {
                          setNotice(null);
                          open(item, setRows).then(showOutcome);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <LoadMore dictionary={dictionary} onLoadMore={loadMore} skeleton={<NotificationSkeleton count={3} />} state={state.paged} />
          </>
        ) : null}
      </div>
    </section>
  );
}
