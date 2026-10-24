'use client';
import { useEffect, useState } from 'react';
import { useSignedInApp } from '../../AppRoot';
import styles from './notices.module.css';
/** Separate server-backed state: deliberately never added to the notification bell totals. */
export function NoticeBadge() {
  const { api, dictionary } = useSignedInApp();
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const request = ++generation;
      api<{ hasUnread: boolean }>({
        path: '/api/v1/notices/unread?platform=web',
      }).then(
        (value) => {
          if (active && request === generation) setUnread(value.hasUnread);
        },
        () => undefined,
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('juple:notices-read', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('juple:notices-read', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api]);
  return unread ? (
    <span className={styles.newBadge} aria-label={dictionary.noticeUnread}>
      N
    </span>
  ) : null;
}
