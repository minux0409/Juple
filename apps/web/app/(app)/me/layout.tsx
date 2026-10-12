'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { activeSettingsItem, SETTINGS_NAV_ITEMS, settingsNavLabel } from '../../../lib/settingsNav';
import { useSignedInApp } from '../AppRoot';
import { ConfirmDialog } from '../ConfirmDialog';
import { Glyph } from '../Glyph';
import styles from '../app.module.css';

/**
 * 내 페이지 and everything it opens (프로필 편집, 언어, 컬렉션 잠금, 구독, 계정, 계정 삭제) share ONE settings shell:
 * [app side bar] [settings rail] [wide content]. The rail is a column of its own against the side bar (not a floating card),
 * the content pane takes the rest. 친구 and 삭제 이력 are main destinations (side bar) and render without it. Every page keeps its
 * own address, so back / forward and old links work as before.
 */
export default function MeLayout({ children }: { readonly children: React.ReactNode }) {
  const pathname = usePathname();
  const { dictionary, signOut } = useSignedInApp();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const active = activeSettingsItem(pathname);
  if (!active) {
    return <>{children}</>;
  }
  return (
    <div className={styles.mySettings} data-settings-shell>
      <nav aria-label={dictionary.settingsSectionTitle} className={styles.settingsRail}>
        <h2 className={styles.settingsRailTitle}>{dictionary.settingsSectionTitle}</h2>
        <ul className={styles.settingsRailList}>
          {SETTINGS_NAV_ITEMS.filter(item => !item.danger).map((item, index, shown) => (
            <li className={index > 0 && shown[index - 1].group !== item.group ? styles.settingsRailGroupStart : undefined} key={item.key}>
              <Link
                aria-current={item.key === active.key ? 'page' : undefined}
                className={`${item.key === active.key ? styles.settingsNavLinkActive : styles.settingsNavLink}${item.danger ? ` ${styles.settingsNavDanger}` : ''}`}
                href={item.href}
              >
                {settingsNavLabel(item.key, dictionary)}
              </Link>
            </li>
          ))}
        </ul>
        <div className={styles.settingsRailFooter}>
          <button className={styles.settingsNavAction} onClick={() => setConfirmSignOut(true)} type="button">
            <Glyph name="Logout" size={18} />
            {dictionary.logout}
          </button>
          <div aria-hidden className={styles.settingsRailDivider} />
          {SETTINGS_NAV_ITEMS.filter(item => item.danger).map(item => (
            <Link
              aria-current={item.key === active.key ? 'page' : undefined}
              className={`${item.key === active.key ? styles.settingsNavLinkActive : styles.settingsNavLink} ${styles.settingsNavDanger}`}
              href={item.href}
              key={item.key}
            >
              {settingsNavLabel(item.key, dictionary)}
            </Link>
          ))}
        </div>
      </nav>
      <ConfirmDialog
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.logout}
        message={dictionary.signOutConfirmMessage}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          signOut();
        }}
        open={confirmSignOut}
        title={dictionary.signOutConfirmTitle}
      />
      <div className={styles.settingsPane}>{children}</div>
    </div>
  );
}
