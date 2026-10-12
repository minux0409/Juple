'use client';

import { useSignedInApp } from './AppRoot';
import styles from './app.module.css';

/** A destination that is not on the Web yet: its real title and a plain note - never an empty page or invented content. */
export function ComingSoon({ titleKey }: { readonly titleKey: 'navArchive' }) {
  const { dictionary } = useSignedInApp();
  return (
    <section className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{dictionary[titleKey]}</h1>
        </div>
      </div>
      <div className={styles.inlineState}>
        <p className={styles.stateTitle}>{dictionary.comingSoonTitle}</p>
        <p className={styles.stateMessage}>{dictionary.comingSoonMessage}</p>
      </div>
    </section>
  );
}
