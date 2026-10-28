/**
 * The Admin V2 sidebar: six operating screens, and at the bottom only the account and system entries. Older screens (workspace
 * statistics, UTC analytics, the expense ledger, revenue details, operations) keep their URLs and are reachable from the screen
 * they belong to and from 관리자 계정 > 기존 운영 도구 - none of them was removed.
 */
export type NavIcon = 'dashboard' | 'users' | 'notices' | 'inquiries' | 'costs' | 'appVersion' | 'account' | 'system';

export interface NavEntry {
  readonly label: string;
  readonly href: string;
  readonly icon: NavIcon;
  /** Older paths that belong to this entry (the entry is highlighted on them). */
  readonly includes?: readonly string[];
}

export const NAVIGATION: readonly NavEntry[] = [
  { label: '대시보드', href: '/', icon: 'dashboard', includes: ['/workspace', '/links', '/analytics', '/operations'] },
  { label: '사용자', href: '/users', icon: 'users', includes: ['/workspace/users'] },
  { label: '공지사항', href: '/notices', icon: 'notices' },
  { label: '문의 관리', href: '/inquiries', icon: 'inquiries' },
  { label: '비용 및 수익', href: '/costs', icon: 'costs', includes: ['/expenses', '/revenue'] },
  { label: '앱 버전 관리', href: '/app-version', icon: 'appVersion', includes: ['/operations/app-version'] },
];

export const FOOTER_NAVIGATION: readonly NavEntry[] = [
  { label: '관리자 계정', href: '/settings', icon: 'account' },
  { label: '시스템 상태', href: '/operations/system', icon: 'system' },
];

/**
 * The older screens that are no longer in the sidebar but still work (bookmarks keep opening them). Listed on 관리자 계정.
 */
export const LEGACY_TOOLS: readonly { readonly label: string; readonly href: string; readonly description: string }[] = [
  { label: '서비스 현황 (KST 통계)', href: '/workspace', description: '가입·저장·활동·도메인 등 기존 통합 통계' },
  { label: '가입·활동 현황', href: '/workspace/users', description: 'DAU/WAU/MAU, 활동 플랫폼' },
  { label: '저장 및 협업', href: '/links', description: '저장 사용자, 컬렉션, 협업 알림 이벤트' },
  { label: 'UTC 분석', href: '/analytics', description: '기존 UTC 기준 분석 (사용자·저장·국가·플랫폼)' },
  { label: '알림 및 운영', href: '/operations', description: 'FCM/APNs 발송 상태, 알림 이벤트' },
  { label: '비용 원장', href: '/expenses', description: '수동·반복·Azure 비용 원장, 증빙, 내보내기' },
  { label: '매출 및 손익 상세', href: '/revenue', description: '구매 상태와 확정 지출' },
];

/** Whether a link covers the current page ("/" only exactly; a section also covers its sub-pages, e.g. /inquiries/12). */
export function isActive(href: string, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

/** The one entry to mark as current: the most specific match among every entry's own path and its older paths. */
export function activeHref(pathname: string, entries: readonly NavEntry[] = [...NAVIGATION, ...FOOTER_NAVIGATION]): string | null {
  const matches = entries.flatMap(entry =>
    [entry.href, ...(entry.includes ?? [])].filter(href => isActive(href, pathname)).map(href => ({ entry: entry.href, length: href.length })),
  );
  return matches.sort((a, b) => b.length - a.length)[0]?.entry ?? null;
}
