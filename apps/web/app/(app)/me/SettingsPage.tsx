'use client';

import { usePathname } from 'next/navigation';
import { isSettingsShellPath } from '../../../lib/settingsNav';
import { useSignedInApp } from '../AppRoot';
import { BackButton } from '../PageStates';
import { PageHeader } from '../PageHeader';
import styles from '../app.module.css';

/**
 * One page beside 내 페이지: 뒤로 (to 내 페이지 when there is no history) unless it is a main
 * destination of its own (친구, 삭제 이력), its title with an optional line under it, and its content at a readable width.
 */
export function SettingsPage({
  title,
  subtitle,
  actions,
  icon,
  backHref = '/me',
  width = 'narrow',
  children,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly actions?: React.ReactNode;
  /** A main destination's own glyph (친구, 삭제 이력), drawn before the title like the other primary pages. */
  readonly icon?: React.ComponentProps<typeof PageHeader>['icon'];
  /** Where 뒤로 goes without history; null = a main destination (in the side bar), which has no 뒤로. */
  readonly backHref?: string | null;
  /** narrow: one form or a short list; medium: a list that uses more of the window (friends, trash). */
  readonly width?: 'narrow' | 'medium';
  readonly children: React.ReactNode;
}) {
  const { dictionary } = useSignedInApp();
  const framed = isSettingsShellPath(usePathname());
  return (
    <section className={styles.page}>
      {backHref && !framed ? <BackButton dictionary={dictionary} fallbackHref={backHref} /> : null}
      <PageHeader actions={actions} bell={backHref === null} icon={icon} subtitle={subtitle} title={title} />
      <div className={width === 'medium' ? styles.settingsMedium : styles.settings}>{children}</div>
    </section>
  );
}
