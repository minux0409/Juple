'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Glyph } from './Glyph';
import { NotificationBell } from './notifications/NotificationBell';
import styles from './app.module.css';

/**
 * The one header row of a signed-in page: the title (and an optional line under it) on the start side, the page's own actions and
 * the 알림 bell on the end side - all in the same row, centered on the title row, never floating at a corner of the window.
 *
 *   [ title ............................ [actions] [🔔] ]
 *   [ subtitle                                          ]
 *
 * `bell={false}` is for editors (새 링크 검토, 링크 수정, 컬렉션 만들기 / 수정): a form with its own 취소 / 저장 does not need it.
 * The spacing below the header (title row -> content) is the page's `--page-gap` + `--header-gap`, set once in the stylesheet.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  bell = true,
  icon,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly bell?: boolean;
  /** One of the mobile app's own glyphs, drawn before the title (mobile ScreenTitle). */
  readonly icon?: ComponentProps<typeof Glyph>['name'];
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <div className={styles.pageTitleRow}>
          {icon ? (
            <span aria-hidden className={styles.pageTitleIcon}>
              <Glyph name={icon} size={24} />
            </span>
          ) : null}
          <h1 className={styles.pageTitle}>{title}</h1>
        </div>
        {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {actions || bell ? (
        <div className={styles.pageHeaderActions}>
          {actions}
          {bell ? <NotificationBell /> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Detail pages that start with 뒤로: the back button and the bell share one row (no page title row to put the bell in). */
export function BackRow({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.topRow}>
      {children}
      <NotificationBell />
    </div>
  );
}
