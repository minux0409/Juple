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
}

const dictionaries: Record<Locale, Dictionary> = {
  en: {
    open: 'Open',
    loadMore: 'Load more',
    loading: 'Loading…',
    emptyState: 'This collection has no saved links yet.',
    footerNote: 'Saved and organized with Juple.',
    notFoundTitle: "This link isn't available.",
    notFoundMessage: 'It may have been unshared, or the link may be incorrect.',
  },
  ko: {
    open: '열기',
    loadMore: '더 보기',
    loading: '불러오는 중…',
    emptyState: '이 보관함에 저장된 링크가 아직 없습니다.',
    footerNote: 'Juple로 저장하고 관리하세요.',
    notFoundTitle: '더 이상 사용할 수 없는 링크입니다.',
    notFoundMessage: '공유가 해제되었거나 링크가 올바르지 않을 수 있습니다.',
  },
};

export function resolveLocale(acceptLanguageHeader: string | null): Locale {
  const primary = acceptLanguageHeader?.split(',')[0]?.trim().toLowerCase() ?? '';
  return primary.startsWith('ko') ? 'ko' : 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
