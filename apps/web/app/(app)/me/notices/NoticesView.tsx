'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSignedInApp } from '../../AppRoot';
import { SettingsPage } from '../SettingsPage';
import {
  noticeListPath,
  noticeQuery,
  type NoticeDetail,
  type NoticeItem,
  type NoticePage,
} from '../../../../lib/notices';
import { noticeBlocks, safeNoticeUrl } from '../../../../lib/noticeContent';
import { ApiHttpError } from '../../../../lib/appApi';
import { isSessionLost } from '../../../../lib/authSession';
import { LoadFailed } from '../../PageStates';
import styles from './notices.module.css';

export function NoticesView({ id }: { readonly id?: number }) {
  const { api, dictionary: d, locale, onSessionLost } = useSignedInApp();
  const [items, setItems] = useState<readonly NoticeItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<NoticeDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const moreBusy = useRef(false);
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
      new Date(value),
    );
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const generation = ++request.current;
      const path = id
        ? `/api/v1/notices/${id}?${noticeQuery(locale)}`
        : noticeListPath(locale);
      api<NoticePage | NoticeDetail>({ path }).then(
        (value) => {
          if (!active || generation !== request.current) return;
          if ('notice' in value) {
            setDetail(value);
            if (value.notice.isRead) setReadFailed(false);
          } else {
            setItems(value.items);
            setCursor(value.nextCursor);
          }
          setBusy(false);
          setFailed(false);
        },
        (error) => {
          if (!active || generation !== request.current) return;
          if (isSessionLost(error)) onSessionLost();
          if (
            error instanceof ApiHttpError &&
            (error.status === 404 || error.status === 403)
          )
            setDetail(null);
          setFailed(true);
          setBusy(false);
        },
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      active = false;
      request.current++;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, id, locale, onSessionLost, attempt]);
  // Runs after the successful detail render; a hidden page never marks unseen content read.
  useEffect(() => {
    if (!detail || detail.notice.isRead) return;
    let active = true;
    let pending = false;
    const mark = () => {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      api<void>({
        method: 'PUT',
        path: `/api/v1/notices/${detail.notice.id}/read?platform=web`,
        body: { readVersion: detail.notice.readVersion },
      }).then(
        () => {
          if (active) {
            setReadFailed(false);
            window.dispatchEvent(new Event('juple:notices-read'));
          }
        },
        (error) => {
          if (active) {
            pending = false;
            setReadFailed(true);
            if (isSessionLost(error)) onSessionLost();
          }
        },
      );
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', mark);
    };
  }, [api, detail, onSessionLost]);
  const more = useCallback(async () => {
    if (moreBusy.current || !cursor) return;
    moreBusy.current = true;
    setBusy(true);
    const generation = request.current;
    try {
      const page = await api<NoticePage>({
        path: noticeListPath(locale, cursor),
      });
      if (generation === request.current) {
        setItems((old) => [
          ...old,
          ...page.items.filter((n) => !old.some((x) => x.id === n.id)),
        ]);
        setCursor(page.nextCursor);
        setFailed(false);
      }
    } catch (error) {
      if (generation === request.current) {
        if (isSessionLost(error)) onSessionLost();
        setFailed(true);
      }
    } finally {
      moreBusy.current = false;
      if (generation === request.current) setBusy(false);
    }
  }, [api, cursor, locale, onSessionLost]);
  return (
    <SettingsPage
      title={d.noticeTitle}
      subtitle={id ? undefined : d.noticeDescription}
      icon="Bell"
      backHref={id ? '/me/notices' : '/me'}
      width="medium"
    >
      <div className={styles.content} aria-busy={busy}>
        {busy && !detail && !items.length ? (
          <p role="status">{d.processing}</p>
        ) : null}
        {failed ? (
          <LoadFailed
            dictionary={d}
            onRetry={() => {
              setBusy(true);
              setAttempt((a) => a + 1);
            }}
          />
        ) : null}
        {id && detail ? (
          <article>
            <h2 dir="auto" className={styles.title}>
              {detail.notice.title}
            </h2>
            <p className={styles.meta}>
              <time dateTime={detail.notice.publishedAtUtc}>
                {date(detail.notice.publishedAtUtc)}
              </time>
              {detail.notice.isImportant ? (
                <span>{d.noticeImportant}</span>
              ) : null}
            </p>
            <div className={styles.body} lang={detail.notice.language}>
              {noticeBlocks(detail.body).map((block, i) => (
                <p key={i} dir="auto">
                  {block.kind === 'bullet'
                    ? '• '
                    : block.kind === 'number'
                    ? `${block.marker}. `
                    : null}
                  {block.runs.map((run, j) =>
                    run.href ? (
                      <a
                        href={run.href}
                        rel="noopener noreferrer"
                        target="_blank"
                        key={j}
                      >
                        {run.text}
                      </a>
                    ) : (
                      <span key={j}>{run.text}</span>
                    ),
                  )}
                </p>
              ))}
            </div>
            {detail.officialUrl && safeNoticeUrl(detail.officialUrl) ? (
              <a
                href={safeNoticeUrl(detail.officialUrl)!}
                rel="noopener noreferrer"
                target="_blank"
              >
                {d.noticeOfficialLink}
              </a>
            ) : null}
            {readFailed ? (
              <p role="alert">
                {d.noticeReadFailed}
                <button onClick={() => setAttempt((a) => a + 1)} type="button">
                  {d.retry}
                </button>
              </p>
            ) : null}
          </article>
        ) : !id ? (
          <>
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={`/me/notices/${item.id}`} className={styles.card}>
                    <span className={styles.meta}>
                      {item.isPinned ? <span>{d.noticePinned}</span> : null}
                      {item.isImportant ? (
                        <span>{d.noticeImportant}</span>
                      ) : null}
                      <time dateTime={item.publishedAtUtc}>
                        {date(item.publishedAtUtc)}
                      </time>
                      <span>{item.isRead ? d.noticeRead : d.noticeUnread}</span>
                    </span>
                    <span
                      className={
                        item.isRead ? styles.readTitle : styles.unreadTitle
                      }
                      dir="auto"
                    >
                      {item.title}
                    </span>
                    <span className={styles.preview} dir="auto">
                      {item.preview}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {!busy && !failed && !items.length ? <p>{d.noticeEmpty}</p> : null}
            {cursor ? (
              <button
                disabled={busy}
                onClick={() => {
                  void more();
                }}
                type="button"
              >
                {d.noticeMore}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </SettingsPage>
  );
}
