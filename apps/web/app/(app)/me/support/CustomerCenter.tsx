'use client';

import Link from 'next/link';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 고객센터 (mobile CustomerCenterScreen, the Web's part of it): the two legal documents and 문의하기, as the settings rows used
 * everywhere else (one typography; the chevron / external mark, pointer and hover say they are actions). 문의하기 writes to the
 * configured contact mailbox (the same one the privacy policy names) and is shown only when there is one - never an invented address.
 */
export function CustomerCenter({ supportEmail }: { readonly supportEmail: string | null }) {
  const { dictionary } = useSignedInApp();
  return (
    <SettingsPage title={dictionary.customerCenterTitle}>
      <section className={styles.settingsSection}>
        <div className={styles.settingsCard} data-customer-center>
          <Link className={`${styles.settingsRow} ${styles.settingsRowAction}`} href="/terms">
            <span className={styles.settingsLabel}>{dictionary.customerCenterTerms}</span>
            <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
          </Link>
          <Link className={`${styles.settingsRow} ${styles.settingsRowAction}`} href="/privacy">
            <span className={styles.settingsLabel}>{dictionary.customerCenterPrivacy}</span>
            <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
          </Link>
          {supportEmail ? (
            <a className={`${styles.settingsRow} ${styles.settingsRowAction}`} data-support-inquiry href={`mailto:${supportEmail}`}>
              <span className={styles.settingsLabel}>{dictionary.customerCenterInquiry}</span>
              <span className={styles.settingsValue} dir="ltr">
                {supportEmail}
              </span>
            </a>
          ) : null}
        </div>
      </section>
    </SettingsPage>
  );
}
