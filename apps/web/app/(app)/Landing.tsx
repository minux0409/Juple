'use client';

import type { AppDictionary } from '../../lib/appI18n';
import { BrandIcon } from './BrandIcon';
import styles from './app.module.css';

/** Signed out: the Juple icon and name, one line about Juple, and the existing Entra sign-up / sign-in flow behind one button. */
export function Landing({
  dictionary,
  notice,
  onSignIn,
}: {
  readonly dictionary: AppDictionary;
  readonly notice: string | null;
  readonly onSignIn: () => void;
}) {
  return (
    <main className={styles.centered}>
      <div className={styles.landingCard}>
        <BrandIcon size={72} />
        <h1 className={styles.brandName}>Juple</h1>
        <p className={styles.tagline}>{dictionary.brandTagline}</p>
        {notice ? (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        ) : null}
        <button className={styles.primaryButton} onClick={onSignIn} type="button">
          {dictionary.signIn}
        </button>
      </div>
    </main>
  );
}

/** A centered state: checking the login, a configuration problem, or a failure with a retry. */
export function CenteredMessage({
  title,
  message,
  busy = false,
  action,
}: {
  readonly title?: string;
  readonly message: string;
  readonly busy?: boolean;
  readonly action?: { readonly label: string; readonly onPress: () => void };
}) {
  return (
    <main aria-busy={busy} className={styles.centered}>
      <div className={styles.stateCard} role={busy ? 'status' : undefined}>
        {busy ? <div aria-hidden className={styles.spinner} /> : null}
        {title ? <h1 className={styles.stateTitle}>{title}</h1> : null}
        <p className={styles.stateMessage}>{message}</p>
        {action ? (
          <button className={styles.secondaryButton} onClick={action.onPress} type="button">
            {action.label}
          </button>
        ) : null}
      </div>
    </main>
  );
}
