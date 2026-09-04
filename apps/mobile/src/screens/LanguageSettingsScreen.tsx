import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  loadLanguagePreference,
  resolveLanguageForPreference,
  saveLanguagePreference,
  type LanguagePreference,
} from '../i18n/languagePreference';
import i18n from '../i18n';

interface LanguageOption {
  readonly preference: LanguagePreference;
  readonly icon: string;
  readonly labelKey: string;
}

// English intentionally uses a globe, not a national flag - it is Juple's generic `en`, not
// US-specific English (see the request that drove this screen).
const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { preference: 'system', icon: '🌐', labelKey: 'language.system' },
  { preference: 'ko', icon: '🇰🇷', labelKey: 'language.korean' },
  { preference: 'en', icon: '🌐', labelKey: 'language.english' },
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
              <Text style={styles.icon}>{option.icon}</Text>
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
  icon: {
    fontSize: 20,
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
