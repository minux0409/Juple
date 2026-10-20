import { strings } from './strings.ts';

export interface NavEntry {
  readonly label: string;
  /** Null = not implemented yet: shown disabled with "준비중", never a page with made-up numbers. */
  readonly href: string | null;
  readonly children?: readonly NavEntry[];
}

/**
 * The sidebar. 콘텐츠 has no decided moderation scope yet, so it stays disabled instead of showing a placeholder. 분석 reads the
 * analytics overview (docs/analytics.md).
 */
export const NAVIGATION: readonly NavEntry[] = [
  { label: strings.navDashboard, href: '/' },
  { label: strings.navUsers, href: '/users' },
  {
    label: strings.navContent,
    href: null,
    children: [
      { label: strings.navContentLinks, href: null },
      { label: strings.navContentCollections, href: null },
    ],
  },
  { label: strings.navInquiries, href: '/inquiries' },
  { label: strings.navExpenses, href: '/expenses' },
  {
    label: strings.navAnalytics,
    href: null,
    children: [
      { label: strings.navAnalyticsOverview, href: '/analytics' },
      { label: strings.navAnalyticsUsers, href: '/analytics/users' },
      { label: strings.navAnalyticsSaves, href: '/analytics/saves' },
      { label: strings.navAnalyticsCountries, href: '/analytics/countries' },
      { label: strings.navAnalyticsPlatforms, href: '/analytics/platforms' },
    ],
  },
  {
    label: strings.navOperations,
    href: null,
    children: [
      { label: strings.navAppVersion, href: '/operations/app-version' },
      { label: strings.navSystem, href: '/operations/system' },
    ],
  },
];

/** Whether a sidebar link is the current page ("/" only exactly; a section also for its sub-pages, e.g. /inquiries/12). */
export function isActive(href: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

function hrefs(entries: readonly NavEntry[]): string[] {
  return entries.flatMap(entry => [...(entry.href ? [entry.href] : []), ...hrefs(entry.children ?? [])]);
}

/** The one sidebar link to mark as current: the most specific match (/analytics/users, not also /analytics). */
export function activeHref(pathname: string, entries: readonly NavEntry[] = NAVIGATION): string | null {
  return hrefs(entries)
    .filter(href => isActive(href, pathname))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}
