'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { accountLabel } from '../../lib/accountDisplay';
import { useSignedInApp } from './AppRoot';
import { BrandIcon } from './BrandIcon';
import styles from './app.module.css';

/**
 * The signed-in app's frame: the Juple icon and name, the same four destinations as the mobile tabs (홈 / 보관함 / 컬렉션 / 내 페이지 -
 * apps/mobile/src/navigation/MainTabs.tsx), and the content using the width of the window. A side bar on wide screens; a top bar
 * with a scrolling tab row on narrow ones.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const { dictionary, account, profile, signOut } = useSignedInApp();
  const label = accountLabel({ profile, accountName: account.name, accountUsername: account.username }, dictionary.accountFallback);
  const pathname = usePathname();
  const items = [
    { href: '/', label: dictionary.navHome },
    { href: '/archive', label: dictionary.navArchive },
    { href: '/collections', label: dictionary.navCollections },
    { href: '/me', label: dictionary.navMyPage },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.sidebar}>
        <Link className={styles.sidebarBrand} href="/">
          <BrandIcon size={34} />
          <span>Juple</span>
        </Link>
        <nav aria-label={dictionary.mainNavigation} className={styles.nav}>
          {items.map(item => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link aria-current={active ? 'page' : undefined} className={active ? styles.navLinkActive : styles.navLink} href={item.href} key={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className={styles.account}>
          <span className={styles.accountName} dir="auto" title={label}>
            {label}
          </span>
          <button className={styles.linkButton} onClick={signOut} type="button">
            {dictionary.logout}
          </button>
        </div>
      </header>
      <main className={styles.content}>{children}</main>
    </div>
  );
}
