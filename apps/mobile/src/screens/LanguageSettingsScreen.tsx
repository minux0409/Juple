import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LanguageBadge, type LanguageBadgeContent } from '../icons/LanguageBadge';
import {
  loadLanguagePreference,
  resolveLanguageForPreference,
  saveLanguagePreference,
  syncRtlLayoutDirection,
  type LanguagePreference,
} from '../i18n/languagePreference';
import i18n from '../i18n';

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
 * shown in its own name, with a checkmark on the active preference. Selecting a language whose
 * writing direction differs from the current native layout direction (i.e. Arabic <-> any other
 * language) also syncs the native RTL flag - see languagePreference.ts's syncRtlLayoutDirection -
 * which only takes full effect on the next app launch, so a one-line restart notice appears below
 * the list in that case rather than silently leaving the layout half-mirrored.
 */
export function LanguageSettingsScreen() {
  const { t } = useTranslation();
  // Only the bottom inset is needed here - see the JSX below for why top must NOT also be
  // handled by this screen (the native-stack header above it already does).
  const insets = useSafeAreaInsets();
  const [preference, setPreference] = useState<LanguagePreference | null>(null);
  const [pendingPreference, setPendingPreference] = useState<LanguagePreference | null>(null);
  const [isRestartNoticeVisible, setIsRestartNoticeVisible] = useState(false);

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
      const restartNeeded = syncRtlLayoutDirection(resolvedLanguage);
      setIsRestartNoticeVisible(restartNeeded);
      setPreference(nextPreference);
    } finally {
      setPendingPreference(null);
    }
  };

  if (preference === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    // A stack screen with its native-stack header shown (title "언어") - that header already
    // reserves the top safe area (status bar/notch) for itself, so wrapping this in ANOTHER
    // SafeAreaView(edges=['top']) double-applied the inset, which is what pushed the whole list
    // down and made the first row ("시스템 설정 사용") read as clipped/mispositioned right at that
    // boundary (same root cause CollectionDetailsScreen had - see its own history). Bottom still
    // genuinely needs insets.bottom below (no tab bar here to already absorb it).
    <View style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
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
        {isRestartNoticeVisible ? <Text style={styles.restartNotice}>{t('language.restartForRtl')}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 24,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: '#E0E0E0',
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
    color: '#111111',
    flex: 1,
    fontSize: 16,
  },
  checkmark: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
  },
  restartNotice: {
    color: '#666666',
    fontSize: 13,
    marginTop: 16,
  },
});
