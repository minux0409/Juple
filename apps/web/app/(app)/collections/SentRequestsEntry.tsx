'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiHttpError } from '../../../lib/appApi';
import { formatMessage } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import { cancelMySubmission, loadMyPendingCount, loadMySubmissions, type MySubmission } from '../../../lib/collectionApprovals';
import { formatLinkTimestamp, isSafeHttpUrl, siteOf } from '../../../lib/savedLinks';
import { useSignedInApp } from '../AppRoot';
import { ConfirmDialog } from '../ConfirmDialog';
import { Glyph } from '../Glyph';
import { LinkImage } from '../LinkImage';
import { LoadFailed } from '../PageStates';
import { Modal } from '../Modal';
import { OpenOriginalLink } from './OpenOriginalLink';
import { RequestRow } from './RequestRow';
import styles from './ReceivedRequests.module.css';

/**
 * 보낸 승인 요청 on 공유 컬렉션 (mobile 내 승인 대기): how many of MY proposed links still wait for an Owner - one number from the server - and the
 * list behind it (what, which Collection, since when) with 요청 취소. Only my own rows; never the Owner's queue. Shown only while something waits.
 */
export function SentRequestsEntry() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly MySubmission[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<MySubmission | null>(null);
  const inFlight = useRef(false);

  const refreshCount = useCallback(() => {
    loadMyPendingCount(api).then(setCount, caught => {
      if (isSessionLost(caught)) onSessionLost();
    });
  }, [api, onSessionLost]);
  useEffect(() => {
    // Read after the first paint (not synchronously in the effect), so the Collections list is never held back by it.
    const timer = setTimeout(refreshCount, 0);
    return () => clearTimeout(timer);
  }, [refreshCount]);

  const openList = () => {
    setOpen(true);
    setRows(null);
    setFailed(false);
    setNotice(null);
    setError(null);
    loadMySubmissions(api).then(setRows, caught => {
      if (isSessionLost(caught)) onSessionLost();
      else setFailed(true);
    });
  };

  const cancel = async (row: MySubmission) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(row.submissionId);
    setNotice(null);
    setError(null);
    try {
      const outcome = await cancelMySubmission(api, row.submissionId);
      setRows(current => (current ?? []).filter(existing => existing.submissionId !== row.submissionId));
      setNotice(outcome === 'gone' ? dictionary.submissionsAlreadyCancelledOrProcessed : null);
      refreshCount();
    } catch (caught) {
      if (isSessionLost(caught)) onSessionLost();
      else setError(caught instanceof ApiHttpError && caught.status === 429 ? dictionary.tooManyRequests : dictionary.submissionsCancelFailed);
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };

  if (count === 0 && !open) return null;
  // One wrapper: the page's section gap applies to it once, however many dialogs (closed, out of flow) it holds.
  return (
    <div data-request-entry>
      {count > 0 ? (
        <RequestRow
          accessibleLabel={formatMessage(dictionary.requestsMyPendingSubmissionsA11y, { count })}
          count={count}
          expanded={open}
          label={dictionary.requestsMyPendingSubmissions}
          onClick={openList}
          testId="sent-approvals"
          statusText={formatMessage(dictionary.requestsMyPendingStatus, { count })}
          variant="status"
        />
      ) : null}
      <Modal closeLabel={dictionary.close} onClose={() => { if (!inFlight.current) setOpen(false); }} open={open} title={dictionary.submissionsMySheetTitle}>
        <div aria-busy={rows === null && !failed} data-sent-requests>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {failed ? <LoadFailed dictionary={dictionary} onRetry={openList} /> : null}
          {rows === null && !failed ? <p role="status">{dictionary.processing}</p> : null}
          {rows !== null && rows.length === 0 ? <p className={styles.empty}>{dictionary.submissionsMyEmpty}</p> : null}
          {rows !== null && rows.length > 0 ? (
            <ul className={styles.list}>
              {rows.map(row => {
                const title = row.title?.trim() || siteOf(row.url) || row.url;
                const cancelLabel = formatMessage(dictionary.submissionsCancelRequestA11y, { title });
                return (
                  <li className={styles.rowCard} data-my-submission-id={row.submissionId} key={row.submissionId}>
                    <span aria-hidden className={styles.thumb}>
                      <LinkImage fallback={<Glyph name="Link" size={22} />} src={isSafeHttpUrl(row.previewImageUrl) ? row.previewImageUrl : null} />
                    </span>
                    <div className={styles.text}>
                      <p className={styles.title} dir="auto">{title}</p>
                      <p className={styles.url}>{row.url}</p>
                      <div className={styles.meta}>
                        <span>{row.collectionName ?? dictionary.submissionsSharedCollectionShort}</span>
                        <time dateTime={row.submittedAtUtc}>{formatLinkTimestamp(row.submittedAtUtc, locale, true)}</time>
                        <span>{dictionary.submissionsMyStatus}</span>
                      </div>
                    </div>
                    {/* Right end of the row: 바로가기 (the saved page, new tab) and 요청 취소 - each only this request's, never a full-width button below. */}
                    <div className={styles.rowActions}>
                      <OpenOriginalLink title={title} url={row.url} />
                      <button
                        aria-busy={busyId === row.submissionId}
                        aria-label={cancelLabel}
                        className={styles.iconDanger}
                        data-cancel-request={row.submissionId}
                        disabled={busyId !== null}
                        onClick={() => setConfirm(row)}
                        title={dictionary.submissionsCancelRequest}
                        type="button"
                      >
                        <Glyph name="Trash" size={18} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </Modal>
      <ConfirmDialog
        cancelLabel={dictionary.submissionsKeepRequest}
        confirmLabel={dictionary.submissionsCancelRequest}
        destructive
        message={dictionary.submissionsCancelConfirmMessage}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const target = confirm;
          setConfirm(null);
          if (target) void cancel(target);
        }}
        open={confirm !== null}
        title={dictionary.submissionsCancelConfirm}
      />
    </div>
  );
}
