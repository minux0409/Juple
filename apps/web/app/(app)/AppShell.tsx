'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { activeMainNav, MAIN_NAV_ITEMS } from '../../lib/appNavigation';
import { navTourTarget } from '../../lib/tour';
import { forgetUnlocksOutside } from '../../lib/collectionUnlock';
import { forgetItemOpenGrantsOutside } from '../../lib/itemOpenGrant';
import { isItemOverlayOpen } from '../../lib/itemOverlay';
import { useSignedInApp } from './AppRoot';
import { BrandIcon } from './BrandIcon';
import { SidebarAppCard } from './SidebarAppCard';
import { Glyph } from './Glyph';
import { getUnreadCount, lastUnreadRetryAfterSeconds, nextUnreadPollDelayMs, refreshUnreadCount, resetUnreadCount, subscribeUnreadCount } from '../../lib/notificationState';
import { clearReactionStore } from '../../lib/reactionStore';
import { useNotificationActions } from './notifications/useNotificationActions';
import { useAttention } from './useAttention';
import { AttentionBadge } from './AttentionBadge';
import { useStoredChoice } from './useStoredChoice';
import styles from './app.module.css';

/** The side bar's per-browser width choice (wide screens only; the narrow top bar has no collapsed form). */
const SIDEBAR_STORAGE_KEY = 'juple.web.sidebar';
const parseSidebar = (stored: string | null): 'expanded' | 'collapsed' => (stored === 'collapsed' ? 'collapsed' : 'expanded');

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
  const { fetchUnread } = useNotificationActions();
  // The Web has no push channel: ONE slow poll of the bell total while the tab is visible. A rise of that number is what refreshes the
  // 친구 / 컬렉션 badges (the subscription below), so a new friend request shows within about a minute with no reload. Hidden tabs
  // do not poll; failures (a 429 included) back off instead of repeating.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;
    let ticks = 0;
    // Never sooner than the API's own Retry-After (a 429), never sooner than the back-off.
    const schedule = () => { if (!stopped) timer = setTimeout(tick, Math.max(nextUnreadPollDelayMs(failures), failures > 0 ? lastUnreadRetryAfterSeconds() * 1000 : 0)); };
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        failures = (await refreshUnreadCount(fetchUnread)) ? 0 : failures + 1;
        // Every fifth successful tick (about 5 minutes) the badge sources are re-read as a whole too: a request withdrawn or answered on
        // another device changes no unread number, and would otherwise stay on the menu until the next focus.
        ticks += 1;
        if (failures === 0 && ticks % 5 === 0) void store.refresh(undefined, true);
      }
      schedule();
    };
    schedule();
    return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
  }, [fetchUnread, store]);
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
  const counts: Readonly<Record<string, number>> = { '/': snapshot.counts.home, '/archive': snapshot.counts.archive, '/collections': snapshot.counts.collections, '/me/friends': snapshot.counts.friends };
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
  useEffect(() => () => { resetUnreadCount(); clearReactionStore(); }, [store]);
  const active = activeMainNav(pathname);
  const [sidebar, setSidebar] = useStoredChoice(SIDEBAR_STORAGE_KEY, parseSidebar);
  const collapsed = sidebar === 'collapsed';
  const { navRef, position: indicatorPosition } = useActiveIndicator(active, collapsed);
  const { shellRef, headerRef } = useTopBarOffset();

  return (
    <div className={styles.shell} data-app-shell data-sidebar={sidebar} ref={shellRef}>
      <header className={styles.sidebar} ref={headerRef}>
        <div className={styles.sidebarTop}>
          <Link aria-label={collapsed ? 'Juple' : undefined} className={styles.sidebarBrand} href="/">
            <BrandIcon size={32} />
            <span>Juple</span>
          </Link>
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? dictionary.sidebarExpand : dictionary.sidebarCollapse}
            className={styles.sidebarToggle}
            data-sidebar-toggle
            onClick={() => setSidebar(collapsed ? 'expanded' : 'collapsed')}
            title={collapsed ? dictionary.sidebarExpand : dictionary.sidebarCollapse}
            type="button"
          >
            <Glyph className={styles.sidebarToggleIcon} name="Chevron" size={18} />
          </button>
        </div>
        <nav aria-label={dictionary.mainNavigation} className={styles.nav} data-indicator={indicatorPosition ? 'ready' : undefined} ref={navRef}>
          {/* One marker for the whole list, moved (transform) to the active destination - it slides from the previous one. */}
          {indicatorPosition ? <span aria-hidden className={styles.navIndicator} style={{ transform: `translateY(${indicatorPosition.top}px)`, height: indicatorPosition.height }} /> : null}
          {MAIN_NAV_ITEMS.map(item => (
            <Link
              aria-current={item.href === active ? 'page' : undefined}
              aria-label={collapsed ? dictionary[item.labelKey] : undefined}
              className={item.href === active ? styles.navLinkActive : styles.navLink}
              href={item.href}
              key={item.href}
              title={collapsed ? dictionary[item.labelKey] : undefined}
              {...navTourTarget(item.href)}
            >
              <Glyph className={styles.navIcon} name={item.icon} size={20} />
              <span className={styles.navLabel}>{dictionary[item.labelKey]}</span>
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

/**
 * Where the side bar's active marker sits: the active link's offset inside the list (measured, so a long translated name or a
 * collapsed bar never misplaces it). Nothing is drawn until the first measurement - the marker never slides in from the top on load.
 */
function useActiveIndicator(active: string | null, collapsed: boolean) {
  const navRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<{ readonly top: number; readonly height: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }
    const measure = () => {
      const link = nav.querySelector<HTMLElement>('[aria-current="page"]');
      // The narrow top bar (a row) draws its own active state: the marker is only for the vertical side bar.
      if (!link || getComputedStyle(nav).flexDirection !== 'column') {
        setPosition(null);
        return;
      }
      setPosition(previous => (previous && previous.top === link.offsetTop && previous.height === link.offsetHeight ? previous : { top: link.offsetTop, height: link.offsetHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [active, collapsed]);
  return { navRef, position };
}

/**
 * --shell-top-offset: how much of the window's top the shell itself covers - the sticky top bar on narrow screens (its height changes
 * with a long translated label or a large font), 0 beside the side bar. Docked page controls (StickyControls) sit right under it.
 */
function useTopBarOffset() {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const shell = shellRef.current;
    const header = headerRef.current;
    if (!shell || !header) {
      return;
    }
    const update = () => {
      // The narrow top bar spans the whole shell; the side bar is a column beside the content and covers nothing above it.
      const covering = header.getBoundingClientRect().width >= shell.getBoundingClientRect().width - 1;
      shell.style.setProperty('--shell-top-offset', covering ? `${header.offsetHeight}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  return { shellRef, headerRef };
}
