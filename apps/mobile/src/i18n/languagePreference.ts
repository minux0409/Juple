import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';
import i18n, {
  SUPPORTED_LANGUAGES,
  isRtlLanguage,
  resolveSystemLanguage,
  type SupportedLanguage,
} from './index';

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
 * Persists RN's native RTL flag to match the given language. Per React Native's own documented
 * I18nManager behavior (see https://reactnative.dev/docs/i18nmanager), forceRTL() only takes full
 * effect for a newly-created native view hierarchy - i.e. the NEXT cold app launch - never
 * retroactively for screens already mounted in the current process. allowRTL(true) is called
 * unconditionally (idempotent, harmless if already true) so RTL is never blocked at the native
 * layer regardless of which language is active.
 *
 * Returns whether THIS session's native layout direction still mismatches the target language
 * (captured before calling forceRTL, since that is what the already-created root view is actually
 * locked to for this process's lifetime) - true means a restart is needed for fully mirrored
 * native layout to apply. Text content and this codebase's own logical-property styles
 * (marginStart/End, start/end - see SwipeableItemRow/ItemRepresentativeThumbnail/
 * ItemDetailsScreen) still update immediately either way, since those are plain JS/Yoga layout
 * inputs re-evaluated on every render, not the native root's fixed layout-direction flag.
 */
export function syncRtlLayoutDirection(language: SupportedLanguage): boolean {
  const wasRTL = I18nManager.isRTL;
  const desiredIsRTL = isRtlLanguage(language);
  I18nManager.allowRTL(true);
  if (wasRTL !== desiredIsRTL) {
    I18nManager.forceRTL(desiredIsRTL);
  }
  return wasRTL !== desiredIsRTL;
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
  // Runs on every launch, not just when the language changed this call - it also self-corrects
  // the native RTL flag on a fresh install/relaunch where the device's own OS-level RTL setting
  // (independent of this preference) may already differ from the resolved language's direction.
  syncRtlLayoutDirection(language);
}
