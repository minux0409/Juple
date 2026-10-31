'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatMessage } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import {
  blockPath,
  parseReportReceipt,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASONS,
  reportPath,
  reportBody,
  reportErrorMessage,
  reportReasonLabel,
  type ReportReason,
  type ReportTarget,
} from '../../lib/safety';
import { useSignedInApp } from './AppRoot';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toaster';
import styles from './app.module.css';

/** The person a block is about: their Juple ID, and the name to show in the question. */
export interface BlockSubject {
  readonly jupleId: string;
  readonly name: string;
}

interface SafetyApi {
  /** Opens the report dialog for something that is not the caller's own (the server refuses their own, and anything they cannot see). */
  readonly report: (target: ReportTarget) => void;
  /** Asks "block this user?" and, once confirmed, blocks. `onBlocked` runs after the server accepted it. */
  readonly block: (subject: BlockSubject, onBlocked?: () => void) => void;
}

const SafetyContext = createContext<SafetyApi | null>(null);

export function useSafety(): SafetyApi {
  const value = useContext(SafetyContext);
  if (!value) {
    throw new Error('useSafety must be used inside the signed-in app.');
  }
  return value;
}

/**
 * One place for the two safety dialogs, so every screen only says WHAT is being reported or blocked: 신고 (the reason, an optional
 * explanation, send) and 차단 (a question, then the block). Both ask the server; the server decides what is allowed and answers the same
 * for "no such thing" and "you may not see it". Results are said in a toast, never an alert.
 */
export function SafetyProvider({ children }: { readonly children: React.ReactNode }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [blocking, setBlocking] = useState<{ readonly subject: BlockSubject; readonly onBlocked?: () => void } | null>(null);
  const [blockBusy, setBlockBusy] = useState(false);

  const confirmBlock = useCallback(() => {
    if (!blocking || blockBusy) {
      return;
    }
    setBlockBusy(true);
    const { subject, onBlocked } = blocking;
    api<void>({ method: 'POST', path: blockPath(subject.jupleId) }).then(
      () => {
        setBlockBusy(false);
        setBlocking(null);
        toast.showNotice(dictionary.safetyBlockedDone);
        onBlocked?.();
      },
      caught => {
        setBlockBusy(false);
        setBlocking(null);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        toast.showNotice(dictionary.safetyBlockFailed, 'error');
      },
    );
  }, [api, blockBusy, blocking, dictionary.safetyBlockFailed, dictionary.safetyBlockedDone, onSessionLost, toast]);

  const value = useMemo<SafetyApi>(
    () => ({
      report: target => setReporting(target),
      block: (subject, onBlocked) => setBlocking({ subject, onBlocked }),
    }),
    [],
  );

  return (
    <SafetyContext.Provider value={value}>
      {children}
      {reporting ? <ReportDialog onClose={() => setReporting(null)} target={reporting} /> : null}
      <ConfirmDialog
        busy={blockBusy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.safetyBlock}
        destructive
        message={formatMessage(dictionary.safetyBlockConfirmMessage, { name: blocking?.subject.name ?? '' })}
        onCancel={() => setBlocking(null)}
        onConfirm={confirmBlock}
        open={blocking !== null}
        title={dictionary.safetyBlockTitle}
      />
    </SafetyContext.Provider>
  );
}

/** 신고: why, optionally in words, send. The reason is a required choice (nothing is pre-selected: a report is deliberate). */
function ReportDialog({ target, onClose }: { readonly target: ReportTarget; readonly onClose: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current || reason === null) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailed(false);
    api<unknown>({ method: 'POST', path: reportPath(target), body: reportBody(target, reason, details) }).then(
      raw => {
        toast.showNotice(parseReportReceipt(raw).alreadyReported ? dictionary.safetyReportAlready : dictionary.safetyReportReceived);
        onClose();
      },
      caught => {
        sending.current = false;
        setBusy(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
  };

  return (
    <dialog
      aria-labelledby={titleId}
      className={`${styles.dialog} ${styles.collectionDialog}`}
      onCancel={event => {
        event.preventDefault();
        if (!busy) {
          onClose();
        }
      }}
      ref={ref}
    >
      <div className={styles.dialogHead}>
        <h2 className={styles.dialogTitle} id={titleId}>
          {dictionary.safetyReport}
        </h2>
      </div>
      <form className={styles.editorDialogForm} noValidate onSubmit={submit}>
        <div className={`${styles.dialogBody} ${styles.editorDialogFields}`}>
          <fieldset className={styles.reportReasons}>
            <legend className={styles.fieldLabel}>{dictionary.safetyReportReasonTitle}</legend>
            {REPORT_REASONS.map(candidate => (
              <label className={reason === candidate ? `${styles.reportReason} ${styles.reportReasonSelected}` : styles.reportReason} key={candidate}>
                <input checked={reason === candidate} disabled={busy} name="report-reason" onChange={() => setReason(candidate)} type="radio" value={candidate} />
                <span>{reportReasonLabel(candidate, dictionary)}</span>
              </label>
            ))}
          </fieldset>
          <textarea
            aria-label={dictionary.safetyReportDetailsPlaceholder}
            className={styles.textArea}
            disabled={busy}
            maxLength={REPORT_DETAILS_MAX_LENGTH}
            onChange={event => setDetails(event.target.value)}
            placeholder={dictionary.safetyReportDetailsPlaceholder}
            rows={3}
            value={details}
          />
        </div>
        <div className={`${styles.formActions} ${styles.dialogFoot} ${styles.editorDialogFoot}`}>
          {failed ? (
            <p className={styles.fieldError} role="alert">
              {reportErrorMessage(dictionary)}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <button className={styles.settingsAction} disabled={busy} onClick={onClose} type="button">
              {dictionary.cancel}
            </button>
            <button className={styles.primaryAction} data-report-submit disabled={busy || reason === null} type="submit">
              {busy ? dictionary.saving : dictionary.safetyReportSubmit}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
