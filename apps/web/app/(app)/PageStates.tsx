'use client';

import { useRouter } from 'next/navigation';
import type { AppDictionary } from '../../lib/appI18n';
import { Glyph } from './Glyph';
import styles from './app.module.css';

/** "불러오지 못했어요" with 다시 시도 - a network / server failure keeps the session (mobile LoadFailureState). */
export function LoadFailed({ dictionary, onRetry, message }: { readonly dictionary: AppDictionary; readonly onRetry?: () => void; readonly message?: string }) {
  return (
    <div className={styles.inlineState} role="alert">
      <p className={styles.stateTitle}>{dictionary.loadFailedTitle}</p>
      <p className={styles.stateMessage}>{message ?? dictionary.loadFailedMessage}</p>
      {onRetry ? (
        <button className={styles.secondaryButton} onClick={onRetry} type="button">
          {dictionary.retry}
        </button>
      ) : null}
    </div>
  );
}

/** A definitive answer (not found, locked) - said plainly, with nothing of the content behind it. */
export function Notice({ title, message }: { readonly title?: string; readonly message: string }) {
  return (
    <div className={styles.inlineState} role="status">
      {title ? <p className={styles.stateTitle}>{title}</p> : null}
      <p className={styles.stateMessage}>{message}</p>
    </div>
  );
}

/**
 * 뒤로: the browser's own history when this page was reached inside the app, else the given page (a link opened directly in a new
 * tab has nothing to go back to).
 */
export function BackButton({ dictionary, fallbackHref }: { readonly dictionary: AppDictionary; readonly fallbackHref: string }) {
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };
  return (
    <button className={styles.backButton} onClick={goBack} type="button">
      <Glyph className={styles.backIcon} name="Chevron" size={18} />
      <span>{dictionary.back}</span>
    </button>
  );
}
