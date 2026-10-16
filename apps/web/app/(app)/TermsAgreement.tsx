'use client';

import { useId, useRef, useState } from 'react';
import type { AppApi } from '../../lib/appApi';
import type { AppDictionary } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import { parseTermsStatus, TERMS_ACCEPTANCE_PATH, type TermsStatus } from '../../lib/safety';
import { BrandIcon } from './BrandIcon';
import styles from './app.module.css';

type Document = 'terms' | 'privacy';

/**
 * 약관 동의: the first thing a signed-in person sees until the CURRENT Terms are accepted - before the app shell (and so before the
 * tutorial and everything else). Two required agreements (the Terms of Service, the collection and use of personal information), each
 * with its detail and a link to the full page; "all" checks both. There is no skip and no close button: 다음 stays disabled until both
 * are checked. The server records one acceptance per account and Terms version, so another device or a later
 * sign-in never asks again. Same flow and same texts as the mobile app (apps/mobile/src/safety/TermsAgreementScreen).
 */
export function TermsAgreement({
  api,
  dictionary,
  version,
  onAccepted,
  onSessionLost,
}: {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  readonly version: string;
  readonly onAccepted: (status: TermsStatus) => void;
  readonly onSessionLost: () => void;
}) {
  const titleId = useId();
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [open, setOpen] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const allChecked = termsChecked && privacyChecked;

  const toggleAll = (checked: boolean) => {
    setTermsChecked(checked);
    setPrivacyChecked(checked);
  };

  const accept = (event: React.FormEvent) => {
    event.preventDefault();
    if (!allChecked || sending.current) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setFailed(false);
    api<unknown>({ method: 'POST', path: TERMS_ACCEPTANCE_PATH, body: { version } }).then(
      raw => {
        onAccepted(parseTermsStatus(raw) ?? { currentVersion: version, acceptedVersion: version, isAccepted: true });
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

  const required = (name: string) => dictionary.agreementRequired.replace('{name}', name);

  return (
    <main aria-labelledby={titleId} className={styles.agreementPage} data-terms-agreement>
      <form className={styles.agreementCard} noValidate onSubmit={accept}>
        <div className={styles.agreementLockup}>
          <BrandIcon size={38} />
          <span className={styles.brandWordmarkSmall}>Juple</span>
        </div>
        <h1 className={styles.agreementTitle} id={titleId}>
          {dictionary.agreementTitle}
        </h1>
        <p className={styles.agreementSubtitle}>{dictionary.agreementSubtitle}</p>

        <label className={`${styles.agreementRow} ${styles.agreementAll}`}>
          <input checked={allChecked} data-agreement-all disabled={busy} onChange={event => toggleAll(event.target.checked)} type="checkbox" />
          <span>{dictionary.agreementAgreeAll}</span>
        </label>

        <AgreementItem
          checked={termsChecked}
          dataKey="terms"
          detailLabel={dictionary.agreementViewDetail}
          disabled={busy}
          label={required(dictionary.agreementTermsName)}
          onToggle={setTermsChecked}
          open={open === 'terms'}
          setOpen={isOpen => setOpen(isOpen ? 'terms' : null)}
        >
          <Section body={dictionary.agreementTermsServiceBody} title={dictionary.agreementTermsServiceTitle} />
          <Section body={dictionary.agreementTermsContentBody} title={dictionary.agreementTermsContentTitle} />
          <Section body={dictionary.agreementTermsConductBody} title={dictionary.agreementTermsConductTitle} />
          <Section body={dictionary.agreementTermsReportBody} title={dictionary.agreementTermsReportTitle} />
          <Section body={dictionary.agreementTermsRestrictionBody} title={dictionary.agreementTermsRestrictionTitle} />
          <Section body={dictionary.agreementTermsSubscriptionBody} title={dictionary.agreementTermsSubscriptionTitle} />
          <a className={styles.agreementFullLink} href="/terms" rel="noopener noreferrer" target="_blank">
            {dictionary.safetyTermsViewTerms}
          </a>
        </AgreementItem>

        <AgreementItem
          checked={privacyChecked}
          dataKey="privacy"
          detailLabel={dictionary.agreementViewDetail}
          disabled={busy}
          label={required(dictionary.agreementPrivacyName)}
          onToggle={setPrivacyChecked}
          open={open === 'privacy'}
          setOpen={isOpen => setOpen(isOpen ? 'privacy' : null)}
        >
          <Section body={dictionary.agreementPrivacyItemsBody} title={dictionary.agreementPrivacyItemsTitle} />
          <Section body={dictionary.agreementPrivacyPurposeBody} title={dictionary.agreementPrivacyPurposeTitle} />
          <Section body={dictionary.agreementPrivacyRetentionBody} title={dictionary.agreementPrivacyRetentionTitle} />
          <Section body={dictionary.agreementPrivacyRefusalBody} title={dictionary.agreementPrivacyRefusalTitle} />
          <a className={styles.agreementFullLink} href="/privacy" rel="noopener noreferrer" target="_blank">
            {dictionary.safetyTermsViewPrivacy}
          </a>
        </AgreementItem>

        {failed ? (
          <p className={styles.fieldError} role="alert">
            {dictionary.safetyTermsSaveFailed}
          </p>
        ) : null}
        <button className={`${styles.primaryAction} ${styles.agreementNext}`} data-agreement-next disabled={busy || !allChecked} type="submit">
          {busy ? dictionary.saving : dictionary.agreementNext}
        </button>
      </form>
    </main>
  );
}

function AgreementItem({
  checked,
  dataKey,
  detailLabel,
  disabled,
  label,
  onToggle,
  open,
  setOpen,
  children,
}: {
  readonly checked: boolean;
  readonly dataKey: Document;
  readonly detailLabel: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onToggle: (checked: boolean) => void;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly children: React.ReactNode;
}) {
  const panelId = useId();
  return (
    <div className={styles.agreementItem}>
      <div className={styles.agreementRow}>
        <label className={styles.agreementRowMain}>
          <input checked={checked} data-agreement-item={dataKey} disabled={disabled} onChange={event => onToggle(event.target.checked)} type="checkbox" />
          <span>{label}</span>
        </label>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          aria-label={detailLabel}
          className={styles.agreementDetailButton}
          data-agreement-detail={dataKey}
          onClick={() => setOpen(!open)}
          type="button"
        >
          {open ? '⌃' : '›'}
        </button>
      </div>
      {open ? (
        <div className={styles.agreementDetail} id={panelId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <section className={styles.agreementSection}>
      <h2 className={styles.agreementSectionTitle}>{title}</h2>
      <p className={styles.agreementSectionBody}>{body}</p>
    </section>
  );
}
