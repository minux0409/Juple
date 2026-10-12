'use client';

import { useSignedInApp } from '../AppRoot';
import { BackButton } from '../PageStates';
import styles from '../app.module.css';

/**
 * One page beside 내 페이지: 뒤로 (to 내 페이지 when there is no history) unless it is a main
 * destination of its own (친구, 삭제 이력), its title with an optional line under it, and its content at a readable width.
 */
export function SettingsPage({
  title,
  subtitle,
  actions,
  backHref = '/me',
  width = 'narrow',
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
  /** Where 뒤로 goes without history; null = a main destination (in the side bar), which has no 뒤로. */
  readonly backHref?: string | null;
  /** narrow: one form or a short list; medium: a list that uses more of the window (friends, trash). */
  readonly width?: 'narrow' | 'medium';
  readonly children: React.ReactNode;
}) {
  const { dictionary } = useSignedInApp();
  return (
    <section className={styles.page}>
      {backHref ? <BackButton dictionary={dictionary} fallbackHref={backHref} /> : null}
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
        </div>
        {actions ? <div className={styles.headerActions}>{actions}</div> : null}
      </div>
      <div className={width === 'medium' ? styles.settingsMedium : styles.settings}>{children}</div>
    </section>
  );
}
