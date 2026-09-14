import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales, type Locale } from 'react-native-localize';
import ar from './locales/ar.json';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import ptBR from './locales/pt-BR.json';
import ru from './locales/ru.json';
import th from './locales/th.json';
import tr from './locales/tr.json';
import vi from './locales/vi.json';
import zhHans from './locales/zh-Hans.json';
import zhHant from './locales/zh-Hant.json';

// The 17-language set Juple ships static, version-controlled translations for. Order here is only
// the resource registration order below - LanguageSettingsScreen defines its own display order.
export const SUPPORTED_LANGUAGES = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
  'es',
  'fr',
  'de',
  'it',
  'pt-BR',
  'vi',
  'th',
  'id',
  'ru',
  'tr',
  'ar',
  'hi',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

/** Locales whose native UI reads right-to-left - currently just Arabic. */
export const RTL_LANGUAGES: readonly SupportedLanguage[] = ['ar'];

export function isRtlLanguage(language: SupportedLanguage): boolean {
  return (RTL_LANGUAGES as readonly string[]).includes(language);
}

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Chinese is the one language in this set where languageCode alone ("zh") is not enough - the
 * script actually used (Simplified vs Traditional) is what determines which translation reads
 * correctly, not the region. Prefers an explicit scriptCode (Hans/Hant) when the OS reports one,
 * then falls back to the well-known region groupings from the spec: CN/SG default to Simplified,
 * TW/HK/MO default to Traditional. Any other zh region (rare) also falls back to Simplified, since
 * that is the more widely deployed script globally.
 */
function resolveChineseVariant(locale: Locale): 'zh-Hans' | 'zh-Hant' {
  if (locale.scriptCode === 'Hant') {
    return 'zh-Hant';
  }
  if (locale.scriptCode === 'Hans') {
    return 'zh-Hans';
  }
  if (locale.countryCode === 'TW' || locale.countryCode === 'HK' || locale.countryCode === 'MO') {
    return 'zh-Hant';
  }
  return 'zh-Hans';
}

/**
 * Maps the device's full locale list down to one of Juple's 17 supported locales, or the
 * global-service default (English) if nothing matches - never a silent fallback to whichever
 * language happens to be first in resources. Exported so languagePreference.ts can re-resolve the
 * same "system" meaning after a later explicit re-selection, without duplicating this logic.
 *
 * Portuguese is deliberately pinned to pt-BR regardless of country (Juple only ships one Portuguese
 * variant today) - this is a product choice, not a claim that pt-PT and pt-BR are interchangeable.
 */
export function resolveSystemLanguage(): SupportedLanguage {
  for (const locale of getLocales()) {
    if (locale.languageCode === 'zh') {
      return resolveChineseVariant(locale);
    }
    if (locale.languageCode === 'pt') {
      return 'pt-BR';
    }
    if (isSupportedLanguage(locale.languageCode)) {
      return locale.languageCode;
    }
  }
  return FALLBACK_LANGUAGE;
}

// Static, bundled resources only (no i18next-http-backend) - init() resolves synchronously so
// there is no untranslated/blank first frame while App.tsx's first render happens. Every
// translation ships as a version-controlled JSON file under ./locales - never fetched or
// machine-translated at runtime.
i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
    ja: { translation: ja },
    'zh-Hans': { translation: zhHans },
    'zh-Hant': { translation: zhHant },
    es: { translation: es },
    fr: { translation: fr },
    de: { translation: de },
    it: { translation: it },
    'pt-BR': { translation: ptBR },
    vi: { translation: vi },
    th: { translation: th },
    id: { translation: id },
    ru: { translation: ru },
    tr: { translation: tr },
    ar: { translation: ar },
    hi: { translation: hi },
  },
  lng: resolveSystemLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    // React (and RN's Text) already escapes rendered values - avoids double-escaping.
    escapeValue: false,
  },
});

export default i18n;
