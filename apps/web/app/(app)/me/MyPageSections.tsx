'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LANGUAGE_LABEL_KEYS } from '../../../lib/appI18n';
import { COLLECTION_LOCK_PATH, type CollectionLockStatus } from '../../../lib/settings';
import { describeSubscription, PLAY_SUBSCRIPTIONS_URL } from '../../../lib/subscription';
import { useSignedInApp } from '../AppRoot';
import { CollectionGlyph, Glyph } from '../Glyph';
import styles from '../app.module.css';

/** The ids of 내 페이지's sections - the old /me/settings, /me/subscription and /me/account addresses land on them. */
export const MY_PAGE_SECTION_IDS = { settings: 'settings', subscription: 'subscription', account: 'account' } as const;

/** One setting as a row that opens its own screen: icon, name, the current value when known. */
function SettingRow({ href, icon, label, value }: { readonly href: string; readonly icon: React.ReactNode; readonly label: string; readonly value: string | null }) {
  return (
    <Link className={styles.settingsLinkRow} href={href}>
      <span aria-hidden className={styles.settingsRowIcon}>
        {icon}
      </span>
      <span className={styles.settingsLinkLabel}>{label}</span>
      {value ? <span className={styles.settingsLinkMeta}>{value}</span> : null}
      <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
    </Link>
  );
}

/** 설정: 언어 (the chosen language) and 컬렉션 잠금 (whether a lock password is set - read from the server, shown once known). */
export function SettingsSection() {
  const { api, dictionary, languagePreference } = useSignedInApp();
  const [lockStatus, setLockStatus] = useState<CollectionLockStatus | null>(null);

  // Best effort: without it the row simply shows no status.
  useEffect(() => {
    let ignore = false;
    api<CollectionLockStatus>({ path: COLLECTION_LOCK_PATH }).then(
      status => {
        if (!ignore) {
          setLockStatus(status);
        }
      },
      () => undefined,
    );
    return () => {
      ignore = true;
    };
  }, [api]);

  return (
    <section aria-labelledby="my-page-settings" className={styles.settingsSection} id={MY_PAGE_SECTION_IDS.settings}>
      <h2 className={styles.myPageSectionTitle} id="my-page-settings">
        {dictionary.settingsSectionTitle}
      </h2>
      <div className={styles.settingsCard}>
        <SettingRow href="/me/language" icon={<CollectionGlyph icon="Globe" size={18} />} label={dictionary.languageTitle} value={dictionary[LANGUAGE_LABEL_KEYS[languagePreference]]} />
        <SettingRow
          href="/me/collection-lock"
          icon={<Glyph name="Lock" size={18} />}
          label={dictionary.collectionLock}
          value={lockStatus ? (lockStatus.isConfigured ? dictionary.collectionLockConfigured : dictionary.collectionLockNotConfigured) : null}
        />
      </div>
    </section>
  );
}

/**
 * 구독, read-only: the ONE status the server reported (bootstrap entitlement + storeSubscription) with only the dates it sent, and
 * Google Play's own page to manage a Play subscription. Buying, restoring and the price stay in the Android app; the Web does not sell.
 */
export function SubscriptionSection() {
  const { dictionary, locale, entitlement, storeSubscription } = useSignedInApp();
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
      <h2 className={styles.myPageSectionTitle} id="my-page-subscription">
        {dictionary.subscriptionTitle}
      </h2>
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
        {subscribedOnPlay ? (
          <a className={styles.settingsLinkRow} href={PLAY_SUBSCRIPTIONS_URL} rel="noopener noreferrer" target="_blank">
            <span className={styles.settingsLinkLabel}>{dictionary.subscriptionManage}</span>
            <Glyph className={styles.settingsRowIcon} name="ExternalLink" size={16} />
          </a>
        ) : (
          <p className={styles.settingsNote}>{dictionary.subscriptionUnavailablePlatform}</p>
        )}
      </div>
    </section>
  );
}

/** The sign-in e-mail, only when it really is one (an External ID local account's sign-in name). */
function emailOf(username: string | undefined): string | null {
  const value = username?.trim();
  return value && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value) ? value : null;
}

/**
 * 계정, the mobile AccountManagementScreen: how this account signs in (the server's signInMethod), the sign-in e-mail when it is one,
 * and 비밀번호 재설정 for an e-mail account - a fresh sign-in where the sign-in page offers the reset, which comes back to this page
 * (Google / Apple manage their own password).
 */
export function AccountSection() {
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
      <h2 className={styles.myPageSectionTitle} id="my-page-account">
        {dictionary.accountSectionTitle}
      </h2>
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
          <button className={styles.settingsLinkRow} onClick={() => reauthenticate('passwordReset')} type="button">
            <span className={styles.settingsLinkLabel}>{dictionary.accountPasswordReset}</span>
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

/** 위험 구역: 계정 삭제, apart from the rest of the account; it opens the existing deletion flow. */
export function DangerZoneSection() {
  const { dictionary } = useSignedInApp();
  return (
    <section aria-labelledby="my-page-danger" className={styles.dangerZone}>
      <h2 className={styles.dangerZoneHeading} id="my-page-danger">
        {dictionary.dangerZone}
      </h2>
      <div className={styles.dangerZoneCard}>
        <div className={styles.settingsBlock}>
          <p className={styles.settingsBlockTitle}>{dictionary.accountDeleteTitle}</p>
          <p className={styles.stateMessage}>{dictionary.accountDeleteSummary}</p>
        </div>
        <Link className={styles.settingsLinkRowDanger} href="/me/account/delete">
          <Glyph name="Trash" size={18} />
          <span className={styles.settingsLinkLabel}>{dictionary.accountDeleteAction}</span>
          <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
        </Link>
      </div>
    </section>
  );
}
