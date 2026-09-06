import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';

/**
 * First-pass shell for the 내 페이지 tab. There is no per-user profile endpoint yet (no
 * email/name is exposed to the client anywhere in this app), so the account section only shows
 * the one thing already safely known here - that the session is authenticated - rather than
 * inventing or decoding token claims for display. 설정 currently only has 언어 (LanguageSettingsScreen).
 */
export function MyPageScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <Text style={styles.title}>{t('myPage.title')}</Text>

        <Text style={styles.sectionTitle}>{t('myPage.account')}</Text>
        <Text style={styles.accountStatus}>{t('myPage.loggedInAs')}</Text>

        <Text style={styles.sectionTitle}>{t('myPage.settings')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('LanguageSettings')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>{t('settings.language')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('RecentlyOpenedLinks')}
          style={[styles.linkButton, styles.linkButtonSpaced]}
        >
          <Text style={styles.linkButtonLabel}>{t('myPage.viewRecentlyOpenedLinks')}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t('myPage.existingFeatures')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('PurchaseHistory')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>{t('myPage.viewPurchaseHistory')}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut();
          }}
          style={styles.signOutButton}
        >
          <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 32,
    marginBottom: 12,
  },
  accountStatus: {
    color: '#111111',
    fontSize: 15,
  },
  linkButton: {
    alignItems: 'center',
    borderColor: '#9A9A9A',
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 12,
  },
  linkButtonSpaced: {
    marginTop: 10,
  },
  linkButtonLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
  signOutButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 'auto',
    paddingVertical: 12,
  },
  signOutLabel: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '600',
  },
});
