import type { Locale } from './i18n.ts';

/**
 * Strings of the signed-in Web app. A plain dictionary like the public viewer's (lib/i18n.ts) - same two locales, resolved on the
 * server from Accept-Language - with the mobile app's own wording wherever the same thing is said (tabs, 오늘 저장한 링크, the
 * standard load-failure text), so the two never disagree.
 */
export interface AppDictionary {
  readonly brandTagline: string;
  readonly signIn: string;
  readonly signingIn: string;
  readonly checkingLogin: string;
  readonly signInFailed: string;
  readonly signInCancelled: string;
  readonly signInConfigError: string;
  readonly sessionEnded: string;
  readonly logout: string;
  readonly configMissingTitle: string;
  readonly configMissingMessage: string;
  readonly navHome: string;
  readonly navArchive: string;
  readonly navCollections: string;
  readonly navMyPage: string;
  readonly homeTitle: string;
  readonly homeEmpty: string;
  readonly homeDateCount: string;
  readonly viewList: string;
  readonly viewGrid: string;
  readonly viewImage: string;
  readonly viewModeLabel: string;
  readonly collectionsFilterLabel: string;
  readonly filterAll: string;
  readonly filterFavorites: string;
  readonly filterOwned: string;
  readonly filterShared: string;
  readonly emptyAll: string;
  readonly emptyFavorites: string;
  readonly emptyShared: string;
  readonly itemCount: string;
  readonly favorite: string;
  readonly lockedCollection: string;
  readonly sharedCollection: string;
  readonly loadMore: string;
  readonly lockedLink: string;
  readonly loadFailedTitle: string;
  readonly loadFailedMessage: string;
  readonly retry: string;
  readonly comingSoonTitle: string;
  readonly comingSoonMessage: string;
  readonly signedInAs: string;
  readonly accountFallback: string;
  readonly nickname: string;
  readonly nicknameNotSet: string;
  readonly jupleIdLabel: string;
  readonly mainNavigation: string;
}

const dictionaries: Record<Locale, AppDictionary> = {
  ko: {
    brandTagline: '발견한 링크를 빠르게 저장하고, 정리하고, 다시 찾아보세요.',
    signIn: '로그인 / 회원가입',
    signingIn: '로그인 중...',
    checkingLogin: '로그인 정보를 확인하고 있어요',
    signInFailed: '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    signInCancelled: '로그인이 취소되었습니다.',
    signInConfigError: '웹 로그인 설정에 문제가 있어 로그인할 수 없어요. 다시 시도해도 해결되지 않으면 관리자에게 알려 주세요.',
    sessionEnded: '로그인이 만료되었어요. 다시 로그인해 주세요.',
    logout: '로그아웃',
    configMissingTitle: '웹 로그인을 사용할 수 없어요',
    configMissingMessage: '이 서버에 로그인 설정이 아직 없습니다.',
    navHome: '홈',
    navArchive: '보관함',
    navCollections: '컬렉션',
    navMyPage: '내 페이지',
    homeTitle: '오늘 저장한 링크',
    homeEmpty: '오늘 저장한 링크가 아직 없습니다.',
    homeDateCount: '{date} {count}개',
    viewList: '목록 보기',
    viewGrid: '그리드 보기',
    viewImage: '이미지 보기',
    viewModeLabel: '보기 방식',
    collectionsFilterLabel: '컬렉션 필터',
    filterAll: '전체',
    filterFavorites: '즐겨찾기',
    filterOwned: '내 컬렉션',
    filterShared: '공유 컬렉션',
    emptyAll: '컬렉션이 없습니다.',
    emptyFavorites: '즐겨찾기 항목이 없습니다.',
    emptyShared: '공유 중인 컬렉션이 없습니다',
    itemCount: '{count}개',
    favorite: '즐겨찾기',
    lockedCollection: '잠긴 컬렉션',
    sharedCollection: '공유 중인 컬렉션',
    loadMore: '더 보기',
    lockedLink: '잠긴 컬렉션의 링크',
    loadFailedTitle: '불러오지 못했어요',
    loadFailedMessage: '기록을 불러올 수 없습니다.',
    retry: '다시 시도',
    comingSoonTitle: '웹에서는 준비 중이에요',
    comingSoonMessage: '지금은 Juple 앱에서 이용할 수 있어요.',
    signedInAs: '로그인 계정',
    accountFallback: '계정',
    nickname: '닉네임',
    nicknameNotSet: '설정 안 됨',
    jupleIdLabel: 'Juple ID',
    mainNavigation: '주 메뉴',
  },
  en: {
    brandTagline: 'Save the links you find, organize them, and find them again.',
    signIn: 'Sign in / Sign up',
    signingIn: 'Signing in...',
    checkingLogin: 'Checking your login',
    signInFailed: 'Sign-in failed. Please try again in a moment.',
    signInCancelled: 'Sign-in was cancelled.',
    signInConfigError: "Web sign-in isn't set up correctly, so you can't sign in right now. If trying again doesn't help, please let the administrator know.",
    sessionEnded: 'Your sign-in has expired. Please sign in again.',
    logout: 'Log out',
    configMissingTitle: 'Web sign-in is unavailable',
    configMissingMessage: 'Sign-in is not configured on this server yet.',
    navHome: 'Home',
    navArchive: 'Archive',
    navCollections: 'Collections',
    navMyPage: 'My page',
    homeTitle: 'Links saved today',
    homeEmpty: 'No links saved today yet.',
    homeDateCount: '{date} · {count} saved',
    viewList: 'List view',
    viewGrid: 'Grid view',
    viewImage: 'Image view',
    viewModeLabel: 'View',
    collectionsFilterLabel: 'Collection filter',
    filterAll: 'All',
    filterFavorites: 'Favorites',
    filterOwned: 'My collections',
    filterShared: 'Shared',
    emptyAll: 'No collections.',
    emptyFavorites: 'No favorites.',
    emptyShared: 'No shared collections yet.',
    itemCount: '{count} saved',
    favorite: 'Favorite',
    lockedCollection: 'Locked collection',
    sharedCollection: 'Shared collection',
    loadMore: 'Load more',
    lockedLink: 'A link in a locked collection',
    loadFailedTitle: "Couldn't load",
    loadFailedMessage: "Your saved links couldn't be loaded.",
    retry: 'Try again',
    comingSoonTitle: 'Coming to the web soon',
    comingSoonMessage: 'For now, you can use this in the Juple app.',
    signedInAs: 'Signed in as',
    accountFallback: 'Account',
    nickname: 'Nickname',
    nicknameNotSet: 'Not set',
    jupleIdLabel: 'Juple ID',
    mainNavigation: 'Main navigation',
  },
};

export function getAppDictionary(locale: Locale): AppDictionary {
  return dictionaries[locale];
}

/** Fills {name} placeholders - the same {{name}} values the mobile strings use, with single braces. */
export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
