import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LanguageBadge, type LanguageBadgeContent } from '../icons/LanguageBadge';
import {
  loadLanguagePreference,
  resolveLanguageForPreference,
  saveLanguagePreference,
  type LanguagePreference,
} from '../i18n/languagePreference';
import i18n from '../i18n';

interface LanguageOption {
  readonly preference: LanguagePreference;
  readonly badge: LanguageBadgeContent;
  readonly labelKey: string;
}

// A language code badge, not a national flag - `en` is Juple's generic English, not US-specific
// English, and Korean is not tied to a country flag either (see LanguageBadge's own remarks). Add
// another locale (e.g. `ja`, `zh`) here as one more `{ kind: 'code', code: '...' }` entry.
const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { preference: 'system', badge: { kind: 'device' }, labelKey: 'language.system' },
  { preference: 'ko', badge: { kind: 'code', code: 'KO' }, labelKey: 'language.korean' },
  { preference: 'en', badge: { kind: 'code', code: 'EN' }, labelKey: 'language.english' },
];

/** A simple settings list: 시스템 설정 사용 / 한국어 / English, with a checkmark on the active preference. */
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
      await i18n.changeLanguage(resolveLanguageForPreference(nextPreference));
      setPreference(nextPreference);
    } finally {
      setPendingPreference(null);
    }
  };

  if (preference === null) {
    return (
      <SafeAreaView edges={['top']} style={styles.loadingContainer}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
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
      </View>
    </SafeAreaView>
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
});
