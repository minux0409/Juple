import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';
import en from './locales/en.json';
import ko from './locales/ko.json';

export const SUPPORTED_LANGUAGES = ['ko', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const FALLBACK_LANGUAGE: SupportedLanguage = 'en';

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * ko-KR -> ko, en-US/en-GB -> en, anything else -> the global-service default (English) - never a
 * silent fallback to whichever language happens to be first in resources.
 */
function resolveInitialLanguage(): SupportedLanguage {
  for (const locale of getLocales()) {
    if (isSupportedLanguage(locale.languageCode)) {
      return locale.languageCode;
    }
  }
  return FALLBACK_LANGUAGE;
}

// Static, bundled resources only (no i18next-http-backend) - init() resolves synchronously so
// there is no untranslated/blank first frame while App.tsx's first render happens.
i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: {
    // React (and RN's Text) already escapes rendered values - avoids double-escaping.
    escapeValue: false,
  },
});

export default i18n;
