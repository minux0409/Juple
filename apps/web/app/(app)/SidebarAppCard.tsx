'use client';

import type { AppDownload } from '../../lib/appDownload';
import type { AppDictionary } from '../../lib/appI18n';
import styles from './app.module.css';

/** Simple one-colour marks (currentColor, decorative): a play triangle and an apple. The words beside them carry the meaning. */
function PlayMark() {
  return (
    <svg aria-hidden className={styles.sidebarAppIcon} focusable="false" height="16" viewBox="0 0 24 24" width="16">
      <path d="M5 3.4v17.2a.9.9 0 0 0 1.4.8l14.2-8.6a.9.9 0 0 0 0-1.6L6.4 2.6A.9.9 0 0 0 5 3.4z" fill="currentColor" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg aria-hidden className={styles.sidebarAppIcon} focusable="false" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The compact "get the app" block at the bottom of the side bar (desktop). Google Play is a real link; the App Store is a link only
 * when a listing is configured, otherwise a disabled "coming soon" button - never a made-up URL. Each store button has a text name.
 */
export function SidebarAppCard({ dictionary, download }: { readonly dictionary: AppDictionary; readonly download: AppDownload }) {
  return (
    <section aria-labelledby="sidebar-app-title" className={styles.sidebarApp} data-sidebar-app>
      <h2 className={styles.sidebarAppTitle} id="sidebar-app-title">
        {dictionary.sidebarAppTitle}
      </h2>
      <p className={styles.sidebarAppBody}>{dictionary.sidebarAppBody}</p>
      <div className={styles.sidebarAppStores}>
        <a className={styles.sidebarAppStore} data-store="google-play" href={download.googlePlayUrl} rel="noopener noreferrer" target="_blank">
          <PlayMark />
          {dictionary.appGooglePlay}
        </a>
        {download.appStoreUrl ? (
          <a className={styles.sidebarAppStore} data-store="app-store" href={download.appStoreUrl} rel="noopener noreferrer" target="_blank">
            <AppleMark />
            {dictionary.appAppStore}
          </a>
        ) : (
          <button aria-disabled className={styles.sidebarAppStore} data-store="app-store-soon" disabled type="button">
            <AppleMark />
            {dictionary.appAppStore} · {dictionary.appStoreSoonShort}
          </button>
        )}
      </div>
    </section>
  );
}
