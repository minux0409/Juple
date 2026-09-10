import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  STEP_MESSAGE_KEYS,
  bootstrapStepFraction,
  resolveBootstrapError,
  resolveBootstrapStep,
} from '../auth/bootstrapProgress';
import { useAuth } from '../auth/AuthContext';
import { ProgressBar } from '../components/ProgressBar';
import { colors, spacing } from '../theme/tokens';

/**
 * Rendered by RootStack while bootstrap has not reached MainTabs yet (session restore, Entra
 * refresh, backend session validation, or user bootstrap in progress - see bootstrapProgress.ts).
 * Shows exactly one message line + a determinate progress bar tied to real bootstrap steps, or -
 * if bootstrap has actually failed - a plain error/retry view. Replaces the old placeholder that
 * stacked every status line it had ever seen.
 */
export function StartupProgressScreen() {
  const { t } = useTranslation();
  const { signOut, backendAuthStatus, userBootstrapStatus, sessionRestoreStep, retryBootstrap } =
    useAuth();

  const errorInfo = resolveBootstrapError({
    backendAuthStatus,
    userBootstrapStatus,
    sessionRestoreStep,
  });

  if (errorInfo) {
    return (
      <View style={styles.container}>
        <Text style={styles.brand}>Juple</Text>
        <Text style={styles.errorMessage}>{t(errorInfo.messageKey)}</Text>
        {errorInfo.canRetry ? (
          <Pressable accessibilityRole="button" onPress={retryBootstrap} style={styles.retryButton}>
            <Text style={styles.retryLabel}>{t('auth.retry')}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
        </Pressable>
      </View>
    );
  }

  const step = resolveBootstrapStep({ backendAuthStatus, userBootstrapStatus, sessionRestoreStep });

  return (
    <View style={styles.container}>
      <Text style={styles.brand}>Juple</Text>
      <Text style={styles.progressMessage}>{t(STEP_MESSAGE_KEYS[step])}</Text>
      <View style={styles.progressBarWrapper}>
        <ProgressBar progress={bootstrapStepFraction(step)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  brand: {
    fontSize: 32,
    fontWeight: '700',
    marginBottom: spacing.xl,
  },
  progressMessage: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  progressBarWrapper: {
    width: '100%',
  },
  errorMessage: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.textPrimary,
    borderRadius: 8,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl + spacing.md,
    paddingVertical: spacing.md,
  },
  retryLabel: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: '600',
  },
  signOutButton: {
    borderColor: colors.textPrimary,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl + spacing.md,
    paddingVertical: spacing.md,
  },
  signOutLabel: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});
