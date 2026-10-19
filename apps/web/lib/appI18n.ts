import type { MobileStringKey } from './appI18nMobileKeys.ts';

/**
 * Strings of the signed-in Web app, in the mobile app's 17 languages.
 *
 *  - Every string the mobile app already has comes from the mobile locale files (appI18nMobileKeys.ts -> the generated table) -
 *    the same words in every language, never a new translation.
 *  - The few strings that exist only on the Web are below, in Korean and English; other languages show their English, the same
 *    fallback the mobile app uses for a missing key.
 *
 * The language is the mobile 언어 setting's meaning: "system" (the browser's languages, resolved with the mobile rules) or one of the
 * 17 languages, kept per browser in a cookie so the server renders the chosen language at once (no flash of another language).
 *
 * This module is safe for the browser bundle; the 17-language table is read only on the server (appDictionary.ts), which hands one
 * language's dictionary to the page.
 */

/** The mobile SUPPORTED_LANGUAGES, in its order (apps/mobile/src/i18n/index.ts). */
export const APP_LANGUAGES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt-BR', 'vi', 'th', 'id', 'ru', 'tr', 'ar', 'hi'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];
export type LanguagePreference = 'system' | AppLanguage;

/** The per-browser 언어 choice (absent = 시스템 설정 사용). Not account data, not sensitive. */
export const LANGUAGE_COOKIE = 'juple_lang';

const FALLBACK_LANGUAGE: AppLanguage = 'en';

export function isAppLanguage(value: string | null | undefined): value is AppLanguage {
  return (APP_LANGUAGES as readonly string[]).includes(value ?? '');
}

export function parseLanguagePreference(value: string | null | undefined): LanguagePreference {
  return isAppLanguage(value) ? value : 'system';
}

/**
 * The mobile resolveSystemLanguage rules over the browser's Accept-Language list (in its order of preference): Chinese by script
 * (Hant / Hans), else by region (TW / HK / MO = Traditional, any other = Simplified); any Portuguese = pt-BR; otherwise the first
 * supported language; nothing supported = English.
 */
export function resolveSystemLanguage(acceptLanguage: string | null | undefined): AppLanguage {
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(entry => entry.tag && entry.tag !== '*' && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of tags) {
    const subtags = tag.split('-');
    const language = subtags[0].toLowerCase();
    const rest = subtags.slice(1).map(s => s.toLowerCase());
    if (language === 'zh') {
      if (rest.includes('hant')) return 'zh-Hant';
      if (rest.includes('hans')) return 'zh-Hans';
      return rest.some(s => s === 'tw' || s === 'hk' || s === 'mo') ? 'zh-Hant' : 'zh-Hans';
    }
    if (language === 'pt') {
      return 'pt-BR';
    }
    if (isAppLanguage(language)) {
      return language;
    }
  }
  return FALLBACK_LANGUAGE;
}

export function resolveAppLanguage(preference: LanguagePreference, acceptLanguage: string | null | undefined): AppLanguage {
  return preference === 'system' ? resolveSystemLanguage(acceptLanguage) : preference;
}

export function isRtlLanguage(language: AppLanguage): boolean {
  return language === 'ar';
}

/** The 언어 screen's own label for each choice (each language named in itself, as on mobile). */
export const LANGUAGE_LABEL_KEYS: Readonly<Record<LanguagePreference, MobileStringKey>> = {
  system: 'languageSystem',
  ko: 'languageKo',
  en: 'languageEn',
  ja: 'languageJa',
  'zh-Hans': 'languageZhHans',
  'zh-Hant': 'languageZhHant',
  es: 'languageEs',
  fr: 'languageFr',
  de: 'languageDe',
  it: 'languageIt',
  'pt-BR': 'languagePtBR',
  vi: 'languageVi',
  th: 'languageTh',
  id: 'languageId',
  ru: 'languageRu',
  tr: 'languageTr',
  ar: 'languageAr',
  hi: 'languageHi',
};

/** Strings the mobile app does not have - see appDictionary.ts (WEB_ONLY). */
export interface WebOnlyStrings {

  readonly signInSupportingText: string;
  readonly signInTitle: string;
  readonly signInDescription: string;
  readonly signInMicrosoftNote: string;
  readonly signInFeatureSave: string;
  readonly signInFeatureOrganize: string;
  readonly signInFeatureShare: string;
  readonly businessInfo: string;
  readonly businessInfoTitle: string;
  readonly accountDeletionLink: string;
  /** The labels of the business-information dialog (the values are the operator's own data and are not translated). */
  readonly businessOperator: string;
  readonly businessRepresentative: string;
  readonly businessRegistrationNumber: string;
  readonly businessEcommerceNumber: string;
  readonly businessAddress: string;
  readonly businessSupportEmail: string;
  readonly signInConfigError: string;
  /** 처리중 - an inquiry support has started on (Admin Web); the mobile app's own strings have only 접수 / 답변완료. */
  readonly inquiryStatusInProgress: string;
  readonly sessionEnded: string;
  readonly configMissingTitle: string;
  readonly configMissingMessage: string;
  readonly loadFailedMessage: string;
  readonly viewModeLabel: string;
  readonly collectionsFilterLabel: string;
  readonly accountFallback: string;
  readonly mainNavigation: string;
  readonly collectionLockedWebMessage: string;
  readonly back: string;
  readonly profilePhoto: string;
  readonly customColor: string;
  readonly reauthDifferentAccountRestored: string;
  readonly sortGroupLabel: string;
  readonly shareLinkCopied: string;
  readonly shareLinkInAppOnly: string;
  readonly collectionSearchPlaceholder: string;
  readonly seeAll: string;
  readonly dangerZone: string;
  readonly settingsSectionTitle: string;
  readonly accountSectionTitle: string;
  readonly signInMethodLabel: string;
  readonly notificationsSeeAll: string;
  readonly notificationsAppOnly: string;
  readonly notificationsReadAllFailed: string;
  readonly removeFromCollectionAction: string;
  /** 구독: the Web never sells - starting a subscription and its payment are the app's. */
  readonly subscriptionWebAppOnly: string;
  /** the ⋯ menu of a link (move / copy) */
  readonly linkActionsLabel: string;
  /** a Collection shared with me -> a new one of mine */
  readonly cloneToMine: string;
  readonly cloneHint: string;
  readonly cloneSubmit: string;
  readonly clonePartialFailure: string;
  readonly confirmMove: string;
  readonly confirmCopy: string;
  /** 다른 컬렉션과 병합 - the confirmation before anything happens */
  readonly mergeConfirmTitle: string;
  readonly mergeConfirmBody: string;
  readonly mobileLandingTitle: string;
  readonly mobileLandingBody: string;
  readonly appOpen: string;
  readonly appGetOnGooglePlay: string;
  readonly appGetOnAppStore: string;
  readonly appStoreSoon: string;
  readonly appStoreSoonShort: string;
  readonly appContinueOnWeb: string;
  readonly appOpenFailed: string;
  readonly appOpenInAppBrowserHint: string;
  readonly sidebarAppTitle: string;
  readonly sidebarAppBody: string;
  readonly appGooglePlay: string;
  readonly appAppStore: string;
}

export type AppDictionary = WebOnlyStrings & Readonly<Record<MobileStringKey, string>>;

/** Fills {name} placeholders - the mobile strings' {{name}} values, with single braces. */
export function formatMessage(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
