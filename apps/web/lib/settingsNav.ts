import type { AppDictionary } from './appI18n.ts';

/**
 * 내 페이지's own navigation - the nested settings of a signed-in person (Instagram-web style: the app's side bar, an inner settings
 * list, the content). Only features that really exist: 프로필, 언어, 컬렉션 잠금, 구독, 계정, 고객센터 and the deliberate 계정 삭제. 친구 and
 * 삭제 이력 are main destinations of the side bar and are not part of it.
 */
export type SettingsNavKey = 'profile' | 'language' | 'collectionLock' | 'blockedUsers' | 'subscription' | 'account' | 'support' | 'deleteAccount';

export interface SettingsNavItem {
  readonly key: SettingsNavKey;
  readonly href: string;
  /** Every address that highlights this item (the item's own page and the pages it opens). */
  readonly paths: readonly string[];
  /** Items of one group sit together; groups are separated by a divider (no invented headings). */
  readonly group: number;
  readonly danger?: true;
}

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { key: 'profile', href: '/me', paths: ['/me', '/me/profile'], group: 0 },
  { key: 'language', href: '/me/language', paths: ['/me/language'], group: 0 },
  { key: 'collectionLock', href: '/me/collection-lock', paths: ['/me/collection-lock'], group: 1 },
  // 차단한 사용자 (mobile BlockedUsersScreen): who this person blocked, and 차단 해제.
  { key: 'blockedUsers', href: '/me/blocked-users', paths: ['/me/blocked-users'], group: 1 },
  { key: 'subscription', href: '/me/subscription', paths: ['/me/subscription'], group: 2 },
  { key: 'account', href: '/me/account', paths: ['/me/account'], group: 2 },
  // 고객센터 (mobile CustomerCenterScreen): the legal documents and 문의하기.
  { key: 'support', href: '/me/support', paths: ['/me/support'], group: 3 },
  { key: 'deleteAccount', href: '/me/account/delete', paths: ['/me/account/delete'], group: 4, danger: true },
];

function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** The item of the current address, or null (친구 and 삭제 이력 have none: they are not inside the settings). */
export function activeSettingsItem(pathname: string): SettingsNavItem | null {
  const path = normalize(pathname);
  // 고객센터's own pages (a new inquiry, one inquiry) are inside it: /me/support/...
  return SETTINGS_NAV_ITEMS.find(item => item.paths.includes(path) || (item.key === 'support' && path.startsWith('/me/support/'))) ?? null;
}

/** Whether the inner settings list frames this address. */
export function isSettingsShellPath(pathname: string): boolean {
  return activeSettingsItem(pathname) !== null;
}

export function settingsNavLabel(key: SettingsNavKey, dictionary: AppDictionary): string {
  switch (key) {
    case 'profile':
      return dictionary.profileEdit;
    case 'language':
      return dictionary.languageTitle;
    case 'collectionLock':
      return dictionary.collectionLock;
    case 'blockedUsers':
      return dictionary.safetyBlockedUsers;
    case 'subscription':
      return dictionary.subscriptionTitle;
    case 'account':
      return dictionary.accountSectionTitle;
    case 'support':
      return dictionary.customerCenterTitle;
    case 'deleteAccount':
      return dictionary.accountDeleteTitle;
  }
}
