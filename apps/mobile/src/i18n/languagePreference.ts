import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n, { SUPPORTED_LANGUAGES, resolveSystemLanguage, type SupportedLanguage } from './index';

/** "system" always re-resolves the device locale at read time - it is never frozen at the moment it was selected. */
export const LANGUAGE_PREFERENCES = ['system', ...SUPPORTED_LANGUAGES] as const;
export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

const STORAGE_KEY = 'juple.languagePreference';

function isLanguagePreference(value: string): value is LanguagePreference {
  return (LANGUAGE_PREFERENCES as readonly string[]).includes(value);
}

export function resolveLanguageForPreference(preference: LanguagePreference): SupportedLanguage {
  return preference === 'system' ? resolveSystemLanguage() : preference;
}

/** Defaults to "system" - a storage read failure must not crash startup, "system" is the same safe default i18n/index.ts already uses. */
export async function loadLanguagePreference(): Promise<LanguagePreference> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && isLanguagePreference(stored)) {
      return stored;
    }
  } catch {
    // Falls through to "system" below.
  }
  return 'system';
}

export async function saveLanguagePreference(preference: LanguagePreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
}

/**
 * Restores the persisted preference and applies it to the live i18n instance if it differs from
 * the language i18n/index.ts already resolved synchronously at module load (which assumes
 * "system"). Called once during app bootstrap, before RootStack/SignInScreen ever render - see
 * App.tsx - so there is no frame where already-mounted screens show one language and then jump to
 * another.
 */
export async function applyStoredLanguagePreference(): Promise<void> {
  const preference = await loadLanguagePreference();
  const language = resolveLanguageForPreference(preference);
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
}
