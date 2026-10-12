'use client';

import { useEffect, useState } from 'react';
import { formatMessage } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import { displayTitleOf, formatLinkTimestamp, isSafeHttpUrl, siteIdOf, siteOf, thumbnailOf, type ImageRef } from '../../../../lib/savedLinks';
import { useSignedInApp } from '../../AppRoot';
import { ConfirmDialog } from '../../ConfirmDialog';
import { Glyph } from '../../Glyph';
import { LinkImage } from '../../LinkImage';
import { LoadFailed } from '../../PageStates';
import { linkTitleText } from '../../SavedLinkList';
import { SiteIcon } from '../../SiteIcon';
import { SavedLinkSkeleton } from '../../Skeletons';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/** GET /api/v1/items/trash's row (mobile ItemTrashEntry) - deliberately without the memo. */
interface TrashEntry {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly deletedAtUtc: string;
  readonly representativeImage: ImageRef | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: ImageRef | null;
}

/** The server caps the list for everyone (mobile TRASH_LIST_LIMIT) - display only, never sent. */
const TRASH_LIST_LIMIT = 50;

type Pending = { readonly kind: 'restore' | 'permanent'; readonly id: number } | { readonly kind: 'empty' } | null;

/**
 * 삭제 이력 - the mobile TrashScreen: the most recently deleted links (the server keeps the list to the latest 50), each restorable or
 * deletable for good, and 비우기 for the whole server-side trash. Every one of those asks first; nothing is changed by a tap alone.
 */
export default function TrashPage() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [items, setItems] = useState<readonly TrashEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(null);

  useEffect(() => {
    let ignore = false;
    api<{ readonly items: readonly TrashEntry[] }>({ path: '/api/v1/items/trash' }).then(
      result => {
        if (!ignore) {
          setItems(result.items);
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setLoadFailed(true);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken]);

  const run = () => {
    if (!pending || busy) {
      return;
    }
    const action = pending;
    setBusy(true);
    setMessage(null);
    const request =
      action.kind === 'restore'
        ? api<void>({ method: 'POST', path: `/api/v1/items/${action.id}/restore` })
        : action.kind === 'permanent'
          ? api<void>({ method: 'DELETE', path: `/api/v1/items/${action.id}/permanent` })
          : api<void>({ method: 'DELETE', path: '/api/v1/items/trash' });
    request.then(
      () => {
        // Only what the server confirmed leaves the list.
        setItems(previous => (action.kind === 'empty' ? [] : (previous ?? []).filter(entry => entry.id !== action.id)));
        setMessage({ text: action.kind === 'restore' ? dictionary.trashRestoreSuccess : action.kind === 'permanent' ? dictionary.trashPermanentDeleteSuccess : dictionary.trashEmptySuccess, error: false });
        setPending(null);
        setBusy(false);
      },
      caught => {
        setPending(null);
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setMessage({ text: action.kind === 'restore' ? dictionary.trashRestoreError : action.kind === 'permanent' ? dictionary.trashPermanentDeleteError : dictionary.trashEmptyError, error: true });
      },
    );
  };

  const dialog =
    pending?.kind === 'restore'
      ? { title: dictionary.trashRestoreConfirmTitle, message: dictionary.trashRestoreConfirmMessage, confirm: dictionary.trashRestore, destructive: false }
      : pending?.kind === 'permanent'
        ? { title: dictionary.trashPermanentDeleteConfirmTitle, message: dictionary.trashPermanentDeleteConfirmMessage, confirm: dictionary.trashPermanentDelete, destructive: true }
        : { title: dictionary.trashEmptyConfirmTitle, message: dictionary.trashEmptyConfirmMessage, confirm: dictionary.trashEmptyAction, destructive: true };

  return (
    <SettingsPage
      icon="Trash"
      actions={
        items && items.length > 0 ? (
          <button className={styles.dangerAction} disabled={busy} onClick={() => setPending({ kind: 'empty' })} type="button">
            <Glyph name="Trash" size={16} />
            {dictionary.trashEmptyAction}
          </button>
        ) : null
      }
      backHref={null}
      subtitle={formatMessage(dictionary.trashLimitNotice, { count: TRASH_LIST_LIMIT })}
      title={dictionary.trashTitle}
      width="medium"
    >
      {message ? (
        <p className={message.error ? styles.fieldError : styles.formNotice} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
      {items === null && !loadFailed ? <SavedLinkSkeleton count={4} mode="list" /> : null}
      {loadFailed ? (
        <LoadFailed
          dictionary={dictionary}
          message={dictionary.trashLoadError}
          onRetry={() => {
            setLoadFailed(false);
            setItems(null);
            setReloadToken(token => token + 1);
          }}
        />
      ) : null}
      {items && items.length === 0 ? <p className={styles.emptyState}>{dictionary.trashEmpty}</p> : null}
      {items && items.length > 0 ? (
        <ul className={styles.trashGrid}>
          {items.map(entry => {
            const title = displayTitleOf(entry.title, entry.url);
            const thumbnail = thumbnailOf(entry);
            const site = siteOf(entry.url);
            return (
              <li className={styles.trashCard} key={entry.id}>
                <div aria-hidden className={styles.trashThumb}>
                  <LinkImage
                    fallback={
                      <span className={styles.thumbnailFallback}>
                        <SiteIcon siteId={siteIdOf(entry.url)} size={30} />
                      </span>
                    }
                    src={thumbnail}
                  />
                </div>
                <div className={styles.trashBody}>
                  <span className={styles.trashTitle} dir={title.kind === 'text' && title.technical ? 'ltr' : 'auto'}>
                    {linkTitleText(title, dictionary)}
                  </span>
                  <span className={styles.trashMeta}>
                    <time dateTime={entry.deletedAtUtc}>{formatLinkTimestamp(entry.deletedAtUtc, locale, true)}</time>
                  </span>
                  {site ? (
                    <span className={styles.trashSite}>
                      <SiteIcon siteId={siteIdOf(entry.url)} size={16} />
                      <span dir="ltr">{site}</span>
                    </span>
                  ) : null}
                  <div className={styles.trashActions}>
                    <button className={styles.settingsAction} disabled={busy} onClick={() => setPending({ kind: 'restore', id: entry.id })} type="button">
                      <Glyph name="Restore" size={16} />
                      {dictionary.trashRestore}
                    </button>
                    {isSafeHttpUrl(entry.url) ? (
                      <a className={styles.settingsAction} href={entry.url} rel="noopener noreferrer" target="_blank">
                        <Glyph name="ExternalLink" size={16} />
                        {dictionary.openLink}
                      </a>
                    ) : null}
                    <button className={styles.dangerAction} disabled={busy} onClick={() => setPending({ kind: 'permanent', id: entry.id })} type="button">
                      <Glyph name="Trash" size={16} />
                      {dictionary.trashPermanentDelete}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dialog.confirm}
        destructive={dialog.destructive}
        message={dialog.message}
        onCancel={() => setPending(null)}
        onConfirm={run}
        open={pending !== null}
        title={dialog.title}
      />
    </SettingsPage>
  );
}
