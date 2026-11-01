import { parseLanguagePreference } from './appI18n.ts';

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
  readonly privateTitle: string;
  readonly privateMessage: string;
  readonly passwordLabel: string;
  readonly unlock: string;
  readonly unlocking: string;
  readonly wrongPassword: string;
  readonly tooManyAttempts: string;
  readonly unlockFailed: string;
  readonly openInApp: string;
  readonly unavailableTitle: string;
  readonly unavailableMessage: string;
  readonly metaDescription: string;
  readonly landingTagline: string;
  readonly landingAndroidOnly: string;
  readonly landingPrivacy: string;
  readonly landingTerms: string;
  readonly landingAccountDeletion: string;
  readonly landingHeadlineLine1: string;
  readonly landingHeadlineLine2: string;
  readonly landingDescription: string;
  readonly landingFeaturesHeading: string;
  readonly featureSaveTitle: string;
  readonly featureSaveText: string;
  readonly featureOrganizeTitle: string;
  readonly featureOrganizeText: string;
  readonly featureShareTitle: string;
  readonly featureShareText: string;
  readonly notFoundHome: string;
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
    lockedMessage: 'Enter the access password to see the shared links.',
    privateTitle: 'Do you want to join this collection?',
    privateMessage: "The links in this collection are private. Open Juple to ask the owner to let you join; you'll see the collection once they approve.",
    passwordLabel: 'Access password',
    unlock: 'Open',
    unlocking: 'Checking…',
    wrongPassword: "That password isn't correct.",
    tooManyAttempts: 'Too many attempts. Please try again later.',
    unlockFailed: "Couldn't open it right now. Please try again.",
    openInApp: 'Open in Juple',
    unavailableTitle: "We can't show this right now.",
    unavailableMessage: 'Please try again in a moment.',
    metaDescription: 'A collection shared with Juple.',
    landingTagline: 'Save the links you find, organize them, and find them again.',
    landingAndroidOnly: 'Juple is available for Android first.',
    landingPrivacy: 'Privacy Policy',
    landingTerms: 'Terms of Service',
    landingAccountDeletion: 'Account deletion',
    landingHeadlineLine1: 'Save what you discover,',
    landingHeadlineLine2: 'and come back to it later.',
    landingDescription: 'Juple saves the links you find, organizes them into collections, and lets you share them or collect them together with friends.',
    landingFeaturesHeading: 'What you can do with Juple',
    featureSaveTitle: 'Save links',
    featureSaveText: "Save a link straight from another app's share menu, then look back at today's links and your history by date.",
    featureOrganizeTitle: 'Organize into collections',
    featureOrganizeText: 'Sort links into collections you name yourself. One link can live in several collections.',
    featureShareTitle: 'Share and collaborate',
    featureShareText: 'Share a collection with a link, or invite friends to collect links in it together.',
    notFoundHome: 'Go to the Juple home page',
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
    lockedMessage: '공유된 링크를 보려면 접근 비밀번호를 입력하세요.',
    privateTitle: '이 컬렉션에 참여하시겠습니까?',
    privateMessage: '이 컬렉션의 링크는 공개되어 있지 않아요. Juple 앱에서 참가를 요청하면 소유자가 승인한 뒤에 볼 수 있어요.',
    passwordLabel: '접근 비밀번호',
    unlock: '열기',
    unlocking: '확인 중…',
    wrongPassword: '비밀번호가 올바르지 않습니다.',
    tooManyAttempts: '시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    unlockFailed: '지금은 열 수 없습니다. 다시 시도해 주세요.',
    openInApp: 'Juple에서 열기',
    unavailableTitle: '지금은 보여드릴 수 없습니다.',
    unavailableMessage: '잠시 후 다시 시도해 주세요.',
    metaDescription: 'Juple에서 공유된 컬렉션입니다.',
    landingTagline: '발견한 링크를 빠르게 저장하고, 정리하고, 다시 찾아보세요.',
    landingAndroidOnly: 'Juple은 Android 앱으로 먼저 제공됩니다.',
    landingPrivacy: '개인정보처리방침',
    landingTerms: '이용약관',
    landingAccountDeletion: '계정 삭제 안내',
    landingHeadlineLine1: '발견한 것들을 모아두고,',
    landingHeadlineLine2: '나중에 다시 꺼내보세요.',
    landingDescription: '발견한 링크를 저장하고, 컬렉션으로 정리하고, 친구와 공유하거나 함께 모을 수 있는 Juple입니다.',
    landingFeaturesHeading: 'Juple로 할 수 있는 일',
    featureSaveTitle: '링크 저장',
    featureSaveText: '다른 앱의 공유 메뉴에서 바로 저장하고, 오늘 저장한 링크와 지난 기록을 날짜별로 다시 볼 수 있어요.',
    featureOrganizeTitle: '컬렉션 정리',
    featureOrganizeText: '직접 이름 붙인 컬렉션으로 정리하세요. 하나의 링크를 여러 컬렉션에 담을 수 있어요.',
    featureShareTitle: '공유·협업',
    featureShareText: '컬렉션을 링크로 공유하거나, 친구를 초대해 함께 링크를 모을 수 있어요.',
    notFoundHome: 'Juple 홈으로 가기',
  },
};

/**
 * The public pages (shared Collection viewer, store landing, not-found) have Korean and English text only. The visitor's languages are
 * read in their own order of preference (q-values, ties by position): the first one that is Korean or English decides; anything else -
 * or nothing at all - is English, the fallback. A visitor who prefers French but also lists Korean gets Korean, not a guess.
 */
export function resolveLocale(acceptLanguageHeader: string | null): Locale {
  const tags = (acceptLanguageHeader ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(param => param.trim()).find(param => param.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(entry => entry.tag && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of tags) {
    if (tag === 'ko' || tag.startsWith('ko-')) {
      return 'ko';
    }
    if (tag === 'en' || tag.startsWith('en-')) {
      return 'en';
    }
  }
  return 'en';
}

/**
 * The language of a public page (shared Collection, store landing, not-found, the link preview of "/"): the person's saved 언어 choice
 * (the per-browser cookie the signed-in app writes) first - Korean or English is used as chosen; a saved choice we have no public text
 * for (any of the other 15) is English, the fallback, rather than being overridden by the browser - then the browser's own
 * languages (resolveLocale), then English. A missing or invalid cookie counts as no choice. Never read from an account: nobody is signed in.
 */
export function resolvePublicLocale(savedLanguageCookie: string | null | undefined, acceptLanguageHeader: string | null): Locale {
  const saved = parseLanguagePreference(savedLanguageCookie);
  if (saved === 'ko' || saved === 'en') {
    return saved;
  }
  return saved === 'system' ? resolveLocale(acceptLanguageHeader) : 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
