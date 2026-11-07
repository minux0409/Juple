import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Pressable } from '../components/Pressable';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { LanguageBadge, type LanguageBadgeContent } from '../icons/LanguageBadge';
import {
  loadLanguagePreference,
  resolveLanguageForPreference,
  saveLanguagePreference,
  syncRtlLayoutDirection,
  type LanguagePreference,
} from '../i18n/languagePreference';
import i18n from '../i18n';
import { colors, themedStyles } from '../theme/tokens';

interface LanguageOption {
  readonly preference: LanguagePreference;
  readonly badge: LanguageBadgeContent;
  readonly labelKey: string;
}

// A language code badge, not a national flag - `en` is Juple's generic English, not US-specific
// English, and no other language here is tied to a single country either (see LanguageBadge's own
// remarks - pt-BR is a deliberate exception, since Brazil is literally part of the variant name).
// "Use system language" first, then every supported language - each shows its own endonym (see
// i18n/locales' `language.*` keys, identical text in every locale file by design).
const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { preference: 'system', badge: { kind: 'device' }, labelKey: 'language.system' },
  { preference: 'ko', badge: { kind: 'code', code: 'KO' }, labelKey: 'language.korean' },
  { preference: 'en', badge: { kind: 'code', code: 'EN' }, labelKey: 'language.english' },
  { preference: 'ja', badge: { kind: 'code', code: 'JA' }, labelKey: 'language.japanese' },
  { preference: 'zh-Hans', badge: { kind: 'code', code: 'ZH-S' }, labelKey: 'language.chineseSimplified' },
  { preference: 'zh-Hant', badge: { kind: 'code', code: 'ZH-T' }, labelKey: 'language.chineseTraditional' },
  { preference: 'es', badge: { kind: 'code', code: 'ES' }, labelKey: 'language.spanish' },
  { preference: 'fr', badge: { kind: 'code', code: 'FR' }, labelKey: 'language.french' },
  { preference: 'de', badge: { kind: 'code', code: 'DE' }, labelKey: 'language.german' },
  { preference: 'it', badge: { kind: 'code', code: 'IT' }, labelKey: 'language.italian' },
  { preference: 'pt-BR', badge: { kind: 'code', code: 'PT' }, labelKey: 'language.portugueseBrazil' },
  { preference: 'vi', badge: { kind: 'code', code: 'VI' }, labelKey: 'language.vietnamese' },
  { preference: 'th', badge: { kind: 'code', code: 'TH' }, labelKey: 'language.thai' },
  { preference: 'id', badge: { kind: 'code', code: 'ID' }, labelKey: 'language.indonesian' },
  { preference: 'ru', badge: { kind: 'code', code: 'RU' }, labelKey: 'language.russian' },
  { preference: 'tr', badge: { kind: 'code', code: 'TR' }, labelKey: 'language.turkish' },
  { preference: 'ar', badge: { kind: 'code', code: 'AR' }, labelKey: 'language.arabic' },
  { preference: 'hi', badge: { kind: 'code', code: 'HI' }, labelKey: 'language.hindi' },
];

/**
 * A scrollable settings list: "Use system language" followed by all 17 supported languages, each
 * shown in its own name, with a checkmark on the active preference. Switching between an RTL and an
 * LTR language (Arabic <-> any other) re-lays the whole app out at once - see layoutDirection.tsx -
 * so no restart is needed; the native RTL flag is only kept in sync for the next cold launch.
 */
export function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const [preference, setPreference] = useState<LanguagePreference | null>(null);
  const [pendingPreference, setPendingPreference] = useState<LanguagePreference | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      loadLanguagePreference().then(loaded => {
        if (isActive) {
          setPreference(loaded);
        }
      });
      return () => {
        isActive = false;
      };
    }, []),
  );

  const selectPreference = async (nextPreference: LanguagePreference) => {
    if (pendingPreference !== null || preference === nextPreference) {
      return;
    }

    setPendingPreference(nextPreference);
    try {
      await saveLanguagePreference(nextPreference);
      const resolvedLanguage = resolveLanguageForPreference(nextPreference);
      await i18n.changeLanguage(resolvedLanguage);
      // The layout follows the new language at once (see layoutDirection.tsx); this only keeps
      // the native flag right for the next cold launch - no restart needed or suggested.
      syncRtlLayoutDirection(resolvedLanguage);
      setPreference(nextPreference);
    } finally {
      setPendingPreference(null);
    }
  };

  if (preference === null) {
    return (
      <StackScreenSafeArea style={styles.loadingContainer}>
        <ActivityIndicator />
      </StackScreenSafeArea>
    );
  }

  return (
    <StackScreenSafeArea>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="never">
        {LANGUAGE_OPTIONS.map(option => {
          const isSelected = preference === option.preference;
          const isDisabled = pendingPreference !== null;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: isDisabled }}
              disabled={isDisabled}
              key={option.preference}
              onPress={() => selectPreference(option.preference)}
              style={[styles.row, isDisabled && styles.disabledRow]}
            >
              <View style={styles.badgeSlot}>
                <LanguageBadge content={option.badge} />
              </View>
              <Text style={styles.label}>{t(option.labelKey)}</Text>
              {pendingPreference === option.preference ? (
                <ActivityIndicator />
              ) : isSelected ? (
                <Text style={styles.checkmark}>✓</Text>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = themedStyles(() => ({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Top gutter is small on purpose: every row already has 16dp of its own vertical padding, so the first label sits ~20dp under the header
  // (it was 24 + 16 = 40dp). Sides and bottom keep their 24dp (the shared `padding`, no explicit bottom value), so the last row still clears the system navigation bar.
  content: {
    padding: 24,
    paddingTop: 4,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 16,
  },
  disabledRow: {
    opacity: 0.5,
  },
  badgeSlot: {
    marginEnd: 14,
  },
  label: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
  },
  checkmark: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
}));
