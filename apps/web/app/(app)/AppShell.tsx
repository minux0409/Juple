'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { activeMainNav, MAIN_NAV_ITEMS } from '../../lib/appNavigation';
import { navTourTarget } from '../../lib/tour';
import { forgetUnlocksOutside } from '../../lib/collectionUnlock';
import { forgetItemOpenGrantsOutside } from '../../lib/itemOpenGrant';
import { isItemOverlayOpen } from '../../lib/itemOverlay';
import { useSignedInApp } from './AppRoot';
import { BrandIcon } from './BrandIcon';
import { SidebarAppCard } from './SidebarAppCard';
import { Glyph } from './Glyph';
import { getUnreadCount, resetUnreadCount, subscribeUnreadCount } from '../../lib/notificationState';
import { useAttention } from './useAttention';
import { AttentionBadge } from './AttentionBadge';
import styles from './app.module.css';

/**
 * The signed-in app's frame: the Juple icon and name, the main destinations with the mobile icons (lib/appNavigation.ts - the mobile
 * tabs plus 친구 and 삭제 이력), the global 알림 bell at the top end (an action for the whole app, not a destination), and the content.
 * Navigation only: who is signed in and 로그아웃 live in 내 페이지's header. A side bar on wide screens; a top bar with a scrolling
 * row of the same destinations on narrow ones, the bell at its end.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  const { dictionary, appDownload } = useSignedInApp();
  const pathname = usePathname();
  const { store, snapshot } = useAttention();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') void store.refresh(); };
    let lastUnread = getUnreadCount();
    const unsubscribe = subscribeUnreadCount(() => {
      const next = getUnreadCount();
      if (next !== null && lastUnread !== null && next !== lastUnread) void store.refresh(next > lastUnread ? undefined : ['collections'], true);
      lastUnread = next;
    });
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { unsubscribe(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); store.reset(); };
  }, [store]);
  useEffect(() => { void store.refresh(); }, [pathname, store]);
  const counts: Readonly<Record<string, number>> = { '/': snapshot.counts.home, '/archive': snapshot.counts.archive, '/collections': snapshot.counts.collections, '/me/friends': snapshot.counts.friends, '/me': snapshot.counts.myPage };
  // Leaving a Collection's pages ends its visit: its unlock grant is forgotten (it asks for the password again next time).
  useEffect(() => {
    // The Quick Detail sheet names a link in the address while the person's own page (a Collection) is still underneath: that page's
    // visit goes on, and so do its grants.
    if (isItemOverlayOpen()) {
      return;
    }
    forgetUnlocksOutside(pathname);
    // ... and leaving a locked link's pages ends its opening: its grant goes too.
    forgetItemOpenGrantsOutside(pathname);
  }, [pathname]);
  // Signed out (the shell goes away): nobody's unread count stays. The bell itself lives in each page's header.
  useEffect(() => () => resetUnreadCount(), [store]);
  const active = activeMainNav(pathname);

  return (
    <div className={styles.shell}>
      <header className={styles.sidebar}>
        <Link className={styles.sidebarBrand} href="/">
          <BrandIcon size={32} />
          <span>Juple</span>
        </Link>
        <nav aria-label={dictionary.mainNavigation} className={styles.nav}>
          {MAIN_NAV_ITEMS.map(item => (
            <Link aria-current={item.href === active ? 'page' : undefined} className={item.href === active ? styles.navLinkActive : styles.navLink} href={item.href} key={item.href} {...navTourTarget(item.href)}>
              <Glyph className={styles.navIcon} name={item.icon} size={20} />
              <span>{dictionary[item.labelKey]}</span>
              <AttentionBadge count={counts[item.href] ?? 0} />
            </Link>
          ))}
        </nav>
        <SidebarAppCard dictionary={dictionary} download={appDownload} />
      </header>
      <main className={styles.content}>
        <div className={styles.contentInner}>{children}</div>
      </main>
    </div>
  );
}
