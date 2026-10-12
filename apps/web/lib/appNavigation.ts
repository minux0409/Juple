import type { AppDictionary } from './appI18n.ts';
import type { STATUS_ICON_MARKUP } from './collectionIconMarkup.ts';

/**
 * The signed-in app's main destinations: the four mobile tabs (홈 / 보관함 / 컬렉션 / 내 페이지 - apps/mobile/src/navigation/
 * MainTabs.tsx; the last one is called 설정 on the Web) plus 친구 and 삭제 이력, which on the Web are first-level places instead of 내 페이지 rows. Their routes stay where
 * they were (/me/friends, /me/trash); only the navigation moved.
 */
export const MAIN_NAV_ITEMS = [
  { href: '/', labelKey: 'navHome', icon: 'Home' },
  { href: '/archive', labelKey: 'navArchive', icon: 'Archive' },
  { href: '/collections', labelKey: 'navCollections', icon: 'Folder' },
  { href: '/me/friends', labelKey: 'friendsTitle', icon: 'People' },
  { href: '/me/trash', labelKey: 'trashTitle', icon: 'Trash' },
  { href: '/me', labelKey: 'settingsSectionTitle', icon: 'Settings' },
] as const satisfies readonly { readonly href: string; readonly labelKey: keyof AppDictionary; readonly icon: keyof typeof STATUS_ICON_MARKUP }[];

export type MainNavHref = (typeof MAIN_NAV_ITEMS)[number]['href'];

const within = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/**
 * The one main destination a page belongs to, or null (a link's own page, /items/..., belongs to none). A Collection's pages belong
 * to 컬렉션; 친구 and 삭제 이력 to themselves - never also to 내 페이지, although their routes are below /me.
 */
export function activeMainNav(pathname: string): MainNavHref | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/') {
    return '/';
  }
  for (const href of ['/archive', '/collections', '/me/friends', '/me/trash', '/me'] as const) {
    if (within(path, href)) {
      return href;
    }
  }
  return null;
}
