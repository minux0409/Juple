import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteAccount } from '../api/accountApi';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/RootStack';

function getDeleteAccountErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('myPage.deleteAccountErrorFallback');
}

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
  const authenticatedRequest = useAuthenticatedApi();

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  // Synchronous re-entrancy guard against a double-tap triggering two concurrent deletions.
  const isDeletingAccountRef = useRef(false);

  const deleteAccountAction = async () => {
    if (isDeletingAccountRef.current) {
      return;
    }

    isDeletingAccountRef.current = true;
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      await deleteAccount(authenticatedRequest);
      // The account and all its data are already gone server-side at this point - signOut()'s
      // own push-unregister call becomes a harmless no-op. Reuses the existing sign-out flow so
      // there is no separate local-cleanup path to maintain for this screen.
      await signOut();
    } catch (caughtError) {
      isDeletingAccountRef.current = false;
      setIsDeletingAccount(false);
      setDeleteAccountError(getDeleteAccountErrorMessage(caughtError, t));
    }
  };

  const confirmDeleteAccount = () => {
    if (isDeletingAccountRef.current) {
      return;
    }

    Alert.alert(t('myPage.deleteAccountConfirmTitle'), t('myPage.deleteAccountConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: deleteAccountAction },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('myPage.title')}</Text>
        </View>

        <Text style={styles.sectionTitle}>{t('myPage.activity')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('RecentlyOpenedLinks')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>{t('myPage.viewRecentlyOpenedLinks')}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t('myPage.settings')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('LanguageSettings')}
          style={styles.linkButton}
        >
          <Text style={styles.linkButtonLabel}>{t('settings.language')}</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>{t('myPage.account')}</Text>
        <Text style={styles.accountStatus}>{t('myPage.loggedInAs')}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            signOut();
          }}
          style={styles.signOutButton}
        >
          <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
        </Pressable>

        {deleteAccountError ? <Text style={styles.error}>{deleteAccountError}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: isDeletingAccount }}
          disabled={isDeletingAccount}
          onPress={confirmDeleteAccount}
          style={[styles.deleteAccountButton, isDeletingAccount && styles.disabledButton]}
        >
          {isDeletingAccount ? (
            <ActivityIndicator color="#B42318" />
          ) : (
            <Text style={styles.deleteAccountLabel}>{t('myPage.deleteAccount')}</Text>
          )}
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
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  error: {
    color: '#B42318',
    fontSize: 14,
    marginTop: 16,
  },
  deleteAccountButton: {
    alignItems: 'center',
    borderColor: '#B42318',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 12,
    paddingVertical: 12,
  },
  deleteAccountLabel: {
    color: '#B42318',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
