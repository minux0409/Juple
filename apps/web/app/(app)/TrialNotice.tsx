'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { formatMessage } from '../../lib/appI18n';
import { describeTrialNotice, isTrialNoticeClosed, trialNoticeKey } from '../../lib/trialNotice';
import { useSignedInApp } from './AppRoot';
import styles from './app.module.css';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

// Where storage is unavailable the close mark lives for this page only (so 닫기 still works).
const memoryMarks = new Map<string, string>();

/** The close mark kept in this browser: '' = none. */
function readMark(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return memoryMarks.get(key) ?? '';
  }
}

/**
 * A quiet card on Home about the free period: once when it starts (what it is and when it ends) and again, at most daily, in its last
 * 7 days. Closed with 닫기 (kept in this browser); never a modal. The end date is the server's. Nothing shows while the paid program is
 * off, for a subscriber, or for an expired account. The Web never sells, so 구독 보기 only opens the read-only status page.
 */
export function TrialNotice() {
  const { dictionary, entitlement, locale } = useSignedInApp();
  const [now] = useState(() => Date.now());
  const notice = describeTrialNotice(entitlement, now);
  const key = notice ? trialNoticeKey(notice) : '';
  // Hidden on the server and until the browser's close mark has been read (never a flash of a card that was already closed).
  const mark = useSyncExternalStore(
    subscribe,
    () => (key ? readMark(key) : ''),
    () => 'unknown',
  );

  if (!notice || mark === 'unknown') {
    return null;
  }
  if (isTrialNoticeClosed(notice, mark === '' ? null : mark, now)) {
    return null;
  }
  const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(notice.endsAtUtc));
  const title = notice.kind === 'welcome' ? dictionary.trialWelcomeTitle : dictionary.trialEndingTitle;
  const body = formatMessage(notice.kind === 'welcome' ? dictionary.trialWelcomeBody : dictionary.trialEndingBody, { date });
  const close = () => {
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      memoryMarks.set(key, String(Date.now()));
    }
    listeners.forEach(listener => listener());
  };
  return (
    <section aria-label={title} className={styles.trialNotice} data-trial-notice={notice.kind}>
      <div className={styles.trialNoticeText}>
        <h2 className={styles.trialNoticeTitle}>{title}</h2>
        <p className={styles.trialNoticeBody}>{body}</p>
      </div>
      <div className={styles.trialNoticeActions}>
        <Link className={styles.settingsAction} href="/me/subscription">
          {dictionary.trialNoticeView}
        </Link>
        <button className={styles.linkButton} onClick={close} type="button">
          {dictionary.close}
        </button>
      </div>
    </section>
  );
}
