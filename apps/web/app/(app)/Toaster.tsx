'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionLost } from '../../lib/authSession';
import { beginUndo, dismiss, expire, failUndo, finishUndo, showNotice, showUndo, timeoutOf, type ToastState } from '../../lib/undoToast';
import { useSignedInApp } from './AppRoot';
import { Glyph } from './Glyph';
import styles from './app.module.css';

export interface UndoOffer {
  /** "삭제했습니다" - what was done (already on screen by the time this shows). */
  readonly message: string;
  /** What 되돌리기 says when the server refuses (mobile's undoErrorMessage). */
  readonly errorMessage: string;
  /** Reverses exactly that action through the server's own restore; rejects when it could not. */
  readonly undo: () => Promise<void>;
}

export interface ToastApi {
  readonly showUndo: (offer: UndoOffer) => void;
  readonly showNotice: (message: string, tone?: 'info' | 'error') => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** The app-wide snackbar: it lives above every page and the Quick Detail sheet, so it outlives the sheet that closed after a delete. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast needs the signed-in app (ToastProvider).');
  }
  return api;
}

export function ToastProvider({ children }: { readonly children: React.ReactNode }) {
  const { dictionary, onSessionLost } = useSignedInApp();
  const [toast, setToast] = useState<ToastState>(null);
  const toastRef = useRef<ToastState>(null);
  const nextId = useRef(0);
  // The undo of each toast, kept outside the state (a function is not state) and dropped with the toast.
  const undoById = useRef(new Map<number, () => Promise<void>>());

  const update = useCallback((next: ToastState) => {
    toastRef.current = next;
    setToast(next);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      showUndo: offer => {
        const id = ++nextId.current;
        undoById.current.clear();
        undoById.current.set(id, offer.undo);
        update(showUndo(id, offer.message, offer.errorMessage));
      },
      showNotice: (message, tone = 'info') => {
        if (!message) {
          return;
        }
        undoById.current.clear();
        update(showNotice(++nextId.current, message, tone));
      },
    }),
    [update],
  );

  // The time of an offer / notice (none while an undo runs or a failure is being read).
  const timerKey = toast ? `${toast.id}:${toast.kind === 'undo' ? toast.phase : 'notice'}` : null;
  useEffect(() => {
    const current = toastRef.current;
    const timeout = timeoutOf(current);
    if (!current || timeout === null) {
      return undefined;
    }
    const id = current.id;
    const timer = setTimeout(() => {
      undoById.current.delete(id);
      update(expire(toastRef.current, id));
    }, timeout);
    return () => clearTimeout(timer);
  }, [timerKey, update]);

  const runUndo = (id: number) => {
    const { state, start } = beginUndo(toastRef.current, id);
    if (!start) {
      return;
    }
    update(state);
    const undo = undoById.current.get(id);
    (undo ? undo() : Promise.reject(new Error('no undo'))).then(
      () => {
        undoById.current.delete(id);
        update(finishUndo(toastRef.current, id));
      },
      caught => {
        if (isSessionLost(caught)) {
          update(finishUndo(toastRef.current, id));
          onSessionLost();
          return;
        }
        update(failUndo(toastRef.current, id));
      },
    );
  };

  const close = (id: number) => {
    undoById.current.delete(id);
    update(dismiss(toastRef.current, id));
  };

  const failed = toast?.kind === 'undo' && toast.phase === 'failed';
  const isError = failed || (toast?.kind === 'notice' && toast.tone === 'error');
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.toastHost}>
        {toast ? (
          <div
            className={isError ? `${styles.toast} ${styles.toastError}` : styles.toast}
            data-toast={toast.kind === 'undo' ? toast.phase : toast.tone}
            key={toast.id}
            role={isError ? 'alert' : 'status'}
          >
            <span className={styles.toastText}>{toast.kind === 'undo' && failed ? toast.errorMessage : toast.message}</span>
            {toast.kind === 'undo' && !failed ? (
              <button className={styles.toastAction} disabled={toast.phase === 'undoing'} onClick={() => runUndo(toast.id)} type="button">
                {dictionary.undoAction}
              </button>
            ) : null}
            {isError ? (
              <button aria-label={dictionary.close} className={styles.toastClose} onClick={() => close(toast.id)} type="button">
                <Glyph name="Close" size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
