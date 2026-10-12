import type { AppDictionary, AppLanguage, WebOnlyStrings } from './appI18n.ts';
import { MOBILE_STRINGS } from './appI18nMobile.generated.ts';

/**
 * Server only: builds one language's dictionary for the signed-in Web app (the layout hands it to the page). The 17-language table
 * of mobile strings stays on the server; only the chosen language's strings reach the browser.
 */

/** Strings the mobile app does not have (the Web's own sign-in setup, layout labels, and what the Web cannot do yet). */
const WEB_ONLY: Readonly<Record<'ko' | 'en', WebOnlyStrings>> = {
  ko: {
    brandTagline: '발견한 링크를 빠르게 저장하고, 정리하고, 다시 찾아보세요.',
    signInConfigError: '웹 로그인 설정에 문제가 있어 로그인할 수 없어요. 다시 시도해도 해결되지 않으면 관리자에게 알려 주세요.',
    sessionEnded: '로그인이 만료되었어요. 다시 로그인해 주세요.',
    configMissingTitle: '웹 로그인을 사용할 수 없어요',
    configMissingMessage: '이 서버에 로그인 설정이 아직 없습니다.',
    loadFailedMessage: '기록을 불러올 수 없습니다.',
    viewList: '목록 보기',
    viewGrid: '그리드 보기',
    viewImage: '이미지 보기',
    viewModeLabel: '보기 방식',
    collectionsFilterLabel: '컬렉션 필터',
    accountFallback: '계정',
    mainNavigation: '주 메뉴',
    collectionLockedWebMessage: '비밀번호가 필요한 컬렉션은 아직 웹에서 열 수 없어요. Juple 앱에서 열어 주세요.',
    back: '뒤로',
    profilePhoto: '프로필 사진',
    customColor: '직접 선택',
    reauthDifferentAccountRestored: '다른 계정으로 로그인되어 진행하지 않았어요. 원래 계정으로 계속 사용합니다.',
    sortGroupLabel: '정렬',
    shareLinkCopied: '링크를 복사했어요.',
    shareLinkInAppOnly: '아직 공유 링크가 없어요. 공유 링크는 Juple 앱에서 만들 수 있어요.',
    collectionSearchPlaceholder: '컬렉션 검색',
    seeAll: '전체 보기',
    dangerZone: '위험 구역',
    settingsSectionTitle: '설정',
    accountSectionTitle: '계정',
    signInMethodLabel: '로그인 방식',
    notificationsSeeAll: '모두 보기',
    notificationsAppOnly: '이 알림은 Juple 앱에서 열 수 있어요.',
    notificationsReadAllFailed: '모두 읽음으로 표시하지 못했어요. 다시 시도해 주세요.',
  },
  en: {
    brandTagline: 'Save the links you find, organize them, and find them again.',
    signInConfigError: "Web sign-in isn't set up correctly, so you can't sign in right now. If trying again doesn't help, please let the administrator know.",
    sessionEnded: 'Your sign-in has expired. Please sign in again.',
    configMissingTitle: 'Web sign-in is unavailable',
    configMissingMessage: 'Sign-in is not configured on this server yet.',
    loadFailedMessage: 'Your records could not be loaded.',
    viewList: 'List view',
    viewGrid: 'Grid view',
    viewImage: 'Image view',
    viewModeLabel: 'View',
    collectionsFilterLabel: 'Collection filter',
    accountFallback: 'Account',
    mainNavigation: 'Main navigation',
    collectionLockedWebMessage: "Collections that need a password can't be opened on the web yet. Please open it in the Juple app.",
    back: 'Back',
    profilePhoto: 'Profile photo',
    customColor: 'Custom',
    reauthDifferentAccountRestored: 'You signed in with a different account, so nothing was changed. You are still using your original account.',
    sortGroupLabel: 'Sort',
    shareLinkCopied: 'Link copied.',
    shareLinkInAppOnly: 'There is no share link yet. You can create one in the Juple app.',
    collectionSearchPlaceholder: 'Search collections',
    seeAll: 'See all',
    dangerZone: 'Danger zone',
    settingsSectionTitle: 'Settings',
    accountSectionTitle: 'Account',
    signInMethodLabel: 'Sign-in method',
    notificationsSeeAll: 'See all',
    notificationsAppOnly: 'Open this notification in the Juple app.',
    notificationsReadAllFailed: "Couldn't mark all as read. Please try again.",
  },
};

export function getAppDictionary(language: AppLanguage): AppDictionary {
  return {
    ...WEB_ONLY[language === 'ko' ? 'ko' : 'en'],
    ...MOBILE_STRINGS[language],
  };
}
