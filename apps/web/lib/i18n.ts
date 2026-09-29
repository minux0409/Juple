/**
 * Deliberately not a shared package with the Mobile app's i18next setup - this Web Viewer is a
 * single route with a handful of strings, so a plain dictionary object is the maintainable choice
 * here (see docs/development-principles.md: don't add a framework/dependency the task doesn't
 * need). Locale is resolved server-side from the Accept-Language header (see resolveLocale) -
 * never guessed from IP/domain, and User-entered Collection names/Item titles/URLs are never
 * translated.
 */
export type Locale = 'ko' | 'en';

interface Dictionary {
  readonly open: string;
  readonly loadMore: string;
  readonly loading: string;
  readonly emptyState: string;
  readonly footerNote: string;
  readonly notFoundTitle: string;
  readonly notFoundMessage: string;
  readonly installCtaText: string;
  readonly googlePlay: string;
  readonly appStore: string;
  readonly lockedTitle: string;
  readonly lockedMessage: string;
  readonly passwordLabel: string;
  readonly unlock: string;
  readonly unlocking: string;
  readonly wrongPassword: string;
  readonly tooManyAttempts: string;
  readonly unlockFailed: string;
}

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    open: 'Open',
    loadMore: 'Load more',
    loading: 'Loading…',
    emptyState: 'This shared collection has no saved links yet.',
    footerNote: 'Saved and organized with Juple.',
    notFoundTitle: "This link isn't available.",
    notFoundMessage: 'It may have been unshared, or the link may be incorrect.',
    installCtaText: 'Manage this more easily in the Juple app.',
    googlePlay: 'Get it on Google Play',
    appStore: 'Download on the App Store',
    lockedTitle: 'This collection is password protected',
    lockedMessage: 'Enter the share password to see the shared links.',
    passwordLabel: 'Share password',
    unlock: 'Open',
    unlocking: 'Checking…',
    wrongPassword: "That password isn't correct.",
    tooManyAttempts: 'Too many attempts. Please try again later.',
    unlockFailed: "Couldn't open it right now. Please try again.",
  },
  ko: {
    open: '열기',
    loadMore: '더 보기',
    loading: '불러오는 중…',
    emptyState: '이 공유 컬렉션에 저장된 링크가 아직 없습니다.',
    footerNote: 'Juple로 저장하고 관리하세요.',
    notFoundTitle: '더 이상 사용할 수 없는 링크입니다.',
    notFoundMessage: '공유가 해제되었거나 링크가 올바르지 않을 수 있습니다.',
    installCtaText: 'Juple 앱에서 더 편하게 관리하세요.',
    googlePlay: 'Google Play에서 받기',
    appStore: 'App Store에서 받기',
    lockedTitle: '비밀번호로 보호된 컬렉션입니다',
    lockedMessage: '공유된 링크를 보려면 공유 비밀번호를 입력하세요.',
    passwordLabel: '공유 비밀번호',
    unlock: '열기',
    unlocking: '확인 중…',
    wrongPassword: '비밀번호가 올바르지 않습니다.',
    tooManyAttempts: '시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    unlockFailed: '지금은 열 수 없습니다. 다시 시도해 주세요.',
  },
};

export function resolveLocale(acceptLanguageHeader: string | null): Locale {
  const primary = acceptLanguageHeader?.split(',')[0]?.trim().toLowerCase() ?? '';
  return primary.startsWith('ko') ? 'ko' : 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
