'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiHttpError } from '../../../lib/appApi';
import { formatMessage } from '../../../lib/appI18n';
import { DATA_EXPORT_PATH, dataExportDownloadUrl, formatMegabytes, parseDataExportLinks, parseDataExportSummary, type DataExportLinks, type DataExportSummary } from '../../../lib/dataExport';
import { describeSubscription, PLAY_SUBSCRIPTIONS_URL } from '../../../lib/subscription';
import { useSignedInApp } from '../AppRoot';
import { Glyph } from '../Glyph';
import styles from '../app.module.css';

/** The ids of the 구독 and 계정 sections (the in-page anchors of their own pages). */
export const MY_PAGE_SECTION_IDS = { subscription: 'subscription', account: 'account', dataExport: 'data-export' } as const;

/**
 * 구독, read-only: the ONE status the server reported (bootstrap entitlement + storeSubscription) with only the dates it sent, and
 * Google Play's own page to manage a Play subscription. Buying, restoring and the price stay in the app; the Web does not sell, and
 * says so to everyone (subscriptionWebAppOnly).
 */
export function SubscriptionSection({ showTitle = true }: { readonly showTitle?: boolean } = {}) {
  const { dictionary, locale, entitlement, storeSubscription, dataRetention, dataExportEnabled } = useSignedInApp();
  const view = describeSubscription(storeSubscription, entitlement);
  const date = (utc: string | null) => (utc ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(utc)) : null);

  const statusLabel = {
    unknown: dictionary.subscriptionStatusUnknown,
    none: dictionary.subscriptionStatusNone,
    trial: dictionary.subscriptionStatusTrial,
    active: dictionary.subscriptionStatusActive,
    gracePeriod: dictionary.subscriptionStatusGracePeriod,
    canceled: dictionary.subscriptionStatusCanceled,
    expired: dictionary.subscriptionStatusExpired,
    revoked: dictionary.subscriptionStatusRevoked,
  }[view.kind];

  const rows: { readonly label: string; readonly value: string | null }[] = [];
  let note: string | null = null;
  switch (view.kind) {
    case 'trial':
      rows.push({ label: dictionary.subscriptionTrialEndsOn, value: date(view.endsAtUtc) });
      note = dictionary.subscriptionNoteTrial;
      break;
    case 'active':
      rows.push({ label: dictionary.subscriptionStartedOn, value: date(view.startedAtUtc) }, { label: dictionary.subscriptionNextPaymentOn, value: date(view.nextPaymentAtUtc) });
      break;
    case 'gracePeriod':
      rows.push({ label: dictionary.subscriptionStartedOn, value: date(view.startedAtUtc) });
      note = dictionary.subscriptionDetailGrace;
      break;
    case 'canceled':
      rows.push({ label: dictionary.subscriptionStartedOn, value: date(view.startedAtUtc) }, { label: dictionary.subscriptionAccessEndsOn, value: date(view.accessEndsAtUtc) });
      note = dictionary.subscriptionNoteCanceled;
      break;
    case 'expired':
    case 'revoked':
      rows.push({ label: dictionary.subscriptionEndedOn, value: date(view.endedAtUtc) });
      break;
  }
  const subscribedOnPlay = storeSubscription?.platform === 'google' && (view.kind === 'active' || view.kind === 'gracePeriod' || view.kind === 'canceled');

  return (
    <section aria-labelledby="my-page-subscription" className={styles.settingsSection} id={MY_PAGE_SECTION_IDS.subscription}>
      {showTitle ? (
        <h2 className={styles.myPageSectionTitle} id="my-page-subscription">
          {dictionary.subscriptionTitle}
        </h2>
      ) : null}
      <div className={styles.settingsCard}>
        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>{dictionary.subscriptionStateHeading}</span>
          <span className={styles.settingsValue}>{statusLabel}</span>
        </div>
        {rows
          .filter(row => row.value)
          .map(row => (
            <div className={styles.settingsRow} key={row.label}>
              <span className={styles.settingsLabel}>{row.label}</span>
              <span className={styles.settingsValue}>{row.value}</span>
            </div>
          ))}
        {note ? <p className={styles.settingsNote}>{note}</p> : null}
        {/* A Play subscriber keeps Google Play's OWN page (cancel / payment method, as the app opens it) - never a checkout of ours. */}
        {subscribedOnPlay ? (
          <>
            <p className={styles.settingsNote}>{dictionary.subscriptionInfoStoreBody}</p>
            <a className={`${styles.settingsRow} ${styles.settingsRowAction}`} href={PLAY_SUBSCRIPTIONS_URL} rel="noopener noreferrer" target="_blank">
              <span className={styles.settingsLabel}>{dictionary.subscriptionManage}</span>
              <Glyph className={styles.settingsRowIcon} name="ExternalLink" size={16} />
            </a>
          </>
        ) : null}
        {/* The Web never sells: no price, plan or purchase here - starting a subscription and paying are the app's. */}
        <p className={styles.settingsNote} data-subscription-app-only>
          {dictionary.subscriptionWebAppOnly}
        </p>
      </div>
      {dataRetention ? (
        <div className={styles.settingsCard} data-retention-state>
          <p className={styles.settingsBlockTitle}>
            {dataRetention.phase === 'billingHold'
              ? dictionary.retentionBillingHoldTitle
              : dataRetention.phase === 'deletionDue'
                ? dictionary.retentionDeletionDueTitle
                : dictionary.retentionReadOnlyTitle}
          </p>
          <p className={styles.settingsNote}>
            {dataRetention.phase === 'billingHold'
              ? dictionary.retentionBillingHoldBody
              : dataRetention.deletionScheduledAtUtc
                ? formatMessage(dataRetention.phase === 'deletionDue' ? dictionary.retentionDeletionDueBody : dictionary.retentionReadOnlyBody, { date: date(dataRetention.deletionScheduledAtUtc) ?? '' })
                : dictionary.retentionReadOnlyBodyNoDate}
          </p>
          {([
            [dictionary.retentionRowAccessEnded, dataRetention.accessEndedAtUtc],
            [dictionary.retentionRowDeletionScheduled, dataRetention.deletionScheduledAtUtc],
            [dictionary.retentionRowNextNotice, dataRetention.nextNoticeAtUtc],
          ] as const).filter((row): row is readonly [string, string] => Boolean(row[1])).map(([label, utc]) => (
            <div className={styles.settingsRow} key={label}>
              <span className={styles.settingsLabel}>{label}</span>
              <span className={styles.settingsValue}>{date(utc)}</span>
            </div>
          ))}
          {dataExportEnabled ? (
            <a className={`${styles.settingsRow} ${styles.settingsRowAction}`} href={`/me/account#${MY_PAGE_SECTION_IDS.dataExport}`}>
              <span className={styles.settingsLabel}>{dictionary.retentionExportAction}</span>
              <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The sign-in e-mail, only when it really is one (an External ID local account's sign-in name). */
function emailOf(username: string | undefined): string | null {
  const value = username?.trim();
  return value && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value) ? value : null;
}

export function DataExportSection() {
  const { api, apiBaseUrl, dictionary, locale, dataExportEnabled, reauthentication, clearReauthentication, reauthenticate } = useSignedInApp();
  const [summary, setSummary] = useState<DataExportSummary | null>(null);
  const [links, setLinks] = useState<DataExportLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dataExportEnabled) return;
    api<unknown>({ path: DATA_EXPORT_PATH }).then(raw => setSummary(parseDataExportSummary(raw)), () => setNotice(dictionary.dataExportFailed));
  }, [api, dataExportEnabled, dictionary.dataExportFailed]);

  const createLinks = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setLinks(null);
    try {
      const raw = await api<unknown>({ method: 'POST', path: `${DATA_EXPORT_PATH}/links` });
      const parsed = parseDataExportLinks(raw);
      if (!parsed) throw new Error('Invalid data export response');
      setLinks(parsed);
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 403 && error.code === 'recentAuthenticationRequired') {
        reauthenticate('dataExport');
        return;
      }
      setNotice(error instanceof ApiHttpError && error.status === 429 ? dictionary.dataExportRateLimited : dictionary.dataExportFailed);
    } finally {
      setBusy(false);
    }
  }, [api, dictionary.dataExportFailed, dictionary.dataExportRateLimited, reauthenticate]);

  useEffect(() => {
    if (reauthentication?.purpose !== 'dataExport') return;
    const succeeded = reauthentication.outcome === 'reauthenticated';
    clearReauthentication();
    queueMicrotask(() => {
      if (succeeded) void createLinks();
      else setNotice(dictionary.dataExportFailed);
    });
  }, [clearReauthentication, createLinks, dictionary.dataExportFailed, reauthentication]);

  if (!dataExportEnabled) return null;
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const rows = summary ? [
    [dictionary.dataExportRowLinks, count(summary.links)],
    [dictionary.dataExportRowTrash, count(summary.linksInTrash)],
    [dictionary.dataExportRowCollections, count(summary.ownedCollections)],
    [dictionary.dataExportRowShared, count(summary.sharedCollectionsJoined)],
    [dictionary.dataExportRowComments, count(summary.comments)],
    [dictionary.dataExportRowPhotos, count(summary.photos)],
    [dictionary.dataExportRowPhotoSize, formatMessage(dictionary.dataExportMegabytes, { size: formatMegabytes(summary.photoBytes, locale) })],
  ] : [];

  return (
    <section aria-labelledby="data-export-heading" className={styles.settingsSection} id={MY_PAGE_SECTION_IDS.dataExport}>
      <h2 className={styles.myPageSectionTitle} id="data-export-heading">{dictionary.dataExportTitle}</h2>
      <div className={styles.settingsCard}>
        <p className={styles.settingsNote}>{dictionary.dataExportIntro}</p>
        {rows.map(([label, value]) => (
          <div className={styles.settingsRow} key={label}>
            <span className={styles.settingsLabel}>{label}</span><span className={styles.settingsValue}>{value}</span>
          </div>
        ))}
        {summary ? <p className={styles.settingsNote}>{dictionary.dataExportIncludedNote}</p> : null}
        {links ? links.files.map(file => {
          const href = dataExportDownloadUrl(apiBaseUrl, file.downloadPath);
          return href ? (
            <a className={`${styles.settingsRow} ${styles.settingsRowAction}`} href={href} key={file.downloadPath} rel="noopener noreferrer" target="_blank">
              <span className={styles.settingsLabel}>{file.kind === 'data' ? dictionary.dataExportDataFile : formatMessage(dictionary.dataExportPhotoFile, { number: file.number ?? 1 })}</span>
              <span className={styles.settingsValue}>{dictionary.dataExportDownload}</span>
            </a>
          ) : null;
        }) : null}
        <div>
          <button className={styles.primaryAction} disabled={busy} onClick={() => void createLinks()} type="button">
            {busy ? dictionary.processing : dictionary.dataExportCreate}
          </button>
        </div>
        {links ? <p className={styles.settingsNote}>{formatMessage(dictionary.dataExportExpiresNote, { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(links.expiresAtUtc)) })}</p> : null}
        {notice ? <p className={styles.formNotice} role="status">{notice}</p> : null}
      </div>
    </section>
  );
}

/**
 * 계정, the mobile AccountManagementScreen: how this account signs in (the server's signInMethod), the sign-in e-mail when it is one,
 * and 비밀번호 재설정 for an e-mail account - a fresh sign-in where the sign-in page offers the reset, which comes back to this page
 * (Google / Apple manage their own password).
 */
export function AccountSection({ showTitle = true }: { readonly showTitle?: boolean } = {}) {
  const { dictionary, profile, account, reauthentication, clearReauthentication, reauthenticate } = useSignedInApp();
  const [shownNotice] = useState(() => (reauthentication?.purpose === 'passwordReset' && reauthentication.outcome === 'differentAccount' ? dictionary.collectionLockDifferentAccount : null));
  // The result of a fresh sign-in is for this page once; it is cleared after it was read above. Coming back from 비밀번호 재설정
  // lands on this section (the sign-in returns to /me).
  useEffect(() => {
    if (reauthentication?.purpose === 'passwordReset') {
      clearReauthentication();
      document.getElementById(MY_PAGE_SECTION_IDS.account)?.scrollIntoView({ block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const method = profile?.signInMethod === 'email' || profile?.signInMethod === 'google' || profile?.signInMethod === 'apple' ? profile.signInMethod : 'unknown';
  const email = method === 'email' ? emailOf(account.username) : null;
  const methodLabel = { email: dictionary.accountMethodEmail, google: dictionary.accountMethodGoogle, apple: dictionary.accountMethodApple, unknown: dictionary.accountMethodUnknown }[method];

  return (
    <section aria-labelledby="my-page-account" className={styles.settingsSection} id={MY_PAGE_SECTION_IDS.account}>
      {showTitle ? (
        <h2 className={styles.myPageSectionTitle} id="my-page-account">
          {dictionary.accountSectionTitle}
        </h2>
      ) : null}
      {shownNotice ? <p className={styles.formNotice} role="status">{shownNotice}</p> : null}
      <div className={styles.settingsCard}>
        <div className={styles.settingsRow}>
          <span className={styles.settingsLabel}>{dictionary.signInMethodLabel}</span>
          <span className={styles.settingsValue}>{methodLabel}</span>
        </div>
        {email ? (
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>{dictionary.accountMethodEmail}</span>
            <span className={styles.settingsValue} dir="ltr">
              {email}
            </span>
          </div>
        ) : null}
        {method === 'email' ? (
          // The same row and words as 로그인 방식 / 이메일 above (settingsRow + settingsLabel); only the chevron, the pointer and the
          // hover say it is an action.
          <button className={`${styles.settingsRow} ${styles.settingsRowAction}`} onClick={() => reauthenticate('passwordReset')} type="button">
            <span className={styles.settingsLabel}>{dictionary.accountPasswordReset}</span>
            <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
          </button>
        ) : null}
        {method === 'google' || method === 'apple' ? (
          <p className={styles.settingsNote}>{method === 'google' ? dictionary.accountPasswordManagedByGoogle : dictionary.accountPasswordManagedByApple}</p>
        ) : null}
      </div>
    </section>
  );
}
