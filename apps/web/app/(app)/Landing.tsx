'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AppDictionary } from '../../lib/appI18n';
import { BrandIcon } from './BrandIcon';
import { Glyph } from './Glyph';
import { Modal } from './Modal';
import styles from './app.module.css';

export interface BusinessFact {
  readonly label: string;
  readonly value: string;
}

/** Signed out: one focused entry into the existing Entra sign-up / sign-in flow. */
export function Landing({
  dictionary,
  notice,
  onSignIn,
  businessFacts,
}: {
  readonly dictionary: AppDictionary;
  readonly notice: string | null;
  readonly onSignIn: () => void;
  readonly businessFacts: readonly BusinessFact[];
}) {
  const [businessOpen, setBusinessOpen] = useState(false);
  const features = [
    { icon: 'Link' as const, label: dictionary.signInFeatureSave },
    { icon: 'Folder' as const, label: dictionary.signInFeatureOrganize },
    { icon: 'People' as const, label: dictionary.signInFeatureShare },
  ];
  return (
    <main className={styles.signInPage}>
      <div className={styles.signInLayout}>
        <section className={styles.signInBrandPanel} aria-labelledby="sign-in-brand-title">
          <div className={styles.brandLockup}>
            <BrandIcon size={58} />
            <span className={styles.brandWordmark}>Juple</span>
          </div>
          <h1 className={styles.signInHeadline} id="sign-in-brand-title">
            {dictionary.signInHeadlineLine1}
            <br />
            {dictionary.signInHeadlineLine2}
          </h1>
          <p className={styles.signInSupporting}>{dictionary.signInSupportingText}</p>
          <ul className={styles.signInFeatures}>
            {features.map(feature => (
              <li key={feature.icon}>
                <Glyph name={feature.icon} size={19} />
                <span>{feature.label}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.signInCard} aria-labelledby="sign-in-title">
          <div className={styles.signInCardLockup}>
            <BrandIcon size={34} />
            <span className={styles.brandWordmarkSmall}>Juple</span>
          </div>
          <h2 className={styles.signInTitle} id="sign-in-title">{dictionary.signInTitle}</h2>
          <p className={styles.signInDescription}>{dictionary.signInDescription}</p>
          {notice ? <p className={styles.notice} role="alert">{notice}</p> : null}
          <button className={styles.signInButton} onClick={onSignIn} type="button">{dictionary.signIn}</button>
          <p className={styles.authProviderNote}>{dictionary.signInMicrosoftNote}</p>
        </section>
        <footer className={styles.signInFooter}>
          <nav aria-label={dictionary.termsLink}>
            <Link href="/privacy">{dictionary.privacyLink}</Link>
            <Link href="/terms">{dictionary.termsLink}</Link>
            <Link href="/account-deletion">{dictionary.accountDeletionLink}</Link>
            {businessFacts.length > 0 ? <button onClick={() => setBusinessOpen(true)} type="button">{dictionary.businessInfo}</button> : null}
          </nav>
        </footer>
      </div>
      <Modal closeLabel={dictionary.close} onClose={() => setBusinessOpen(false)} open={businessOpen} title={dictionary.businessInfoTitle}>
        <dl className={styles.businessFacts} lang="ko">
          {businessFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      </Modal>
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
        {busy ? <div className={styles.stateBrand}><BrandIcon size={34} /><span className={styles.brandWordmarkSmall}>Juple</span></div> : null}
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
