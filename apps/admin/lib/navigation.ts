import { strings } from './strings.ts';

export interface NavEntry {
  readonly label: string;
  /** Null = not implemented yet: shown disabled with "준비중", never a page with made-up numbers. */
  readonly href: string | null;
  readonly children?: readonly NavEntry[];
}

/**
 * The sidebar. 콘텐츠 and 분석 have no reliable data source yet (no activity, country or per-platform usage is recorded - see
 * docs/admin.md), so they stay disabled instead of showing estimates.
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
  {
    label: strings.navAnalytics,
    href: null,
    children: [
      { label: strings.navAnalyticsUsers, href: null },
      { label: strings.navAnalyticsSaves, href: null },
      { label: strings.navAnalyticsCountries, href: null },
      { label: strings.navAnalyticsPlatforms, href: null },
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
