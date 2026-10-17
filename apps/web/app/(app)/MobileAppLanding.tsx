'use client';

import { useSyncExternalStore } from 'react';
import { androidLaunchAppUrl, CONTINUE_ON_WEB_KEY, planMobileLanding, type AppDownload, type MobileOs } from '../../lib/appDownload';
import type { AppDictionary } from '../../lib/appI18n';
import { BrandIcon } from './BrandIcon';
import styles from './app.module.css';

/**
 * What a phone-sized mobile browser sees instead of the desktop-shaped Web app: the Juple app first. 앱 열기 (Android: Chrome's
 * intent link back to this same page if the app is missing), the store of the visitor's own platform, and a small 웹에서 계속하기 that
 * keeps the Web for this tab session only. Legal pages and public share links are not behind this (they live outside the signed-in
 * app). Tokens only, so Light and Dark follow.
 */
export function MobileAppLanding({
  dictionary,
  os,
  download,
  onContinueOnWeb,
}: {
  readonly dictionary: AppDictionary;
  readonly os: MobileOs;
  readonly download: AppDownload;
  readonly onContinueOnWeb: () => void;
}) {
  const plan = planMobileLanding(os, download);
  const openApp = () => {
    window.location.href = androidLaunchAppUrl(window.location.href);
  };
  return (
    <main className={styles.mobileLanding} data-mobile-landing={os}>
      <BrandIcon size={72} />
      <h1 className={styles.mobileLandingTitle}>{dictionary.mobileLandingTitle}</h1>
      <p className={styles.mobileLandingBody}>{dictionary.mobileLandingBody}</p>
      <div className={styles.mobileLandingActions}>
        {plan.open ? (
          <button className={styles.primaryAction} data-app-open onClick={openApp} type="button">
            {dictionary.appOpen}
          </button>
        ) : null}
        {plan.googlePlay ? (
          <a className={styles.settingsAction} data-store="google-play" href={download.googlePlayUrl} rel="noopener noreferrer">
            {dictionary.appGetOnGooglePlay}
          </a>
        ) : null}
        {plan.appStore && download.appStoreUrl ? (
          <a className={styles.primaryAction} data-store="app-store" href={download.appStoreUrl} rel="noopener noreferrer">
            {dictionary.appGetOnAppStore}
          </a>
        ) : null}
        {plan.appStoreSoon ? (
          <button aria-disabled className={styles.settingsAction} data-store="app-store-soon" disabled type="button">
            {dictionary.appStoreSoon}
          </button>
        ) : null}
        <button className={styles.mobileLandingContinue} data-continue-web onClick={onContinueOnWeb} type="button">
          {dictionary.appContinueOnWeb}
        </button>
      </div>
    </main>
  );
}

let chosenInMemory = false;
const listeners = new Set<() => void>();

function readChosen(): boolean {
  if (chosenInMemory) {
    return true;
  }
  try {
    return window.sessionStorage.getItem(CONTINUE_ON_WEB_KEY) === '1';
  } catch {
    return false;
  }
}

/** The per-tab "continue on the Web" choice (sessionStorage; with storage blocked it only lasts while this page stays open). */
export function useContinueOnWeb(): readonly [boolean, () => void] {
  const chosen = useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    readChosen,
    () => false,
  );
  const choose = () => {
    chosenInMemory = true;
    try {
      window.sessionStorage.setItem(CONTINUE_ON_WEB_KEY, '1');
    } catch {
      // Not remembered across reloads; nothing else depends on it.
    }
    listeners.forEach(listener => listener());
  };
  return [chosen, choose] as const;
}
