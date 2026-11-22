import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { Pressable } from '../components/Pressable';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { JupleBrandMark } from '../components/JupleBrandMark';
import { SubscriptionRights } from './SubscriptionRights';
import { fetchAppUpdatePolicy } from '../appUpdate/appUpdatePolicyApi';
import { openStore } from '../appUpdate/openStore';

/** The Terms status could not be read. Never a way past the Agreement: the person retries or signs out. */
export function TermsUnavailable({ onRetry, onSignOut }: { readonly onRetry: () => void; readonly onSignOut: () => void }) {
  const { t } = useTranslation();
  const [updating, setUpdating] = useState(false);
  const [updateFailed, setUpdateFailed] = useState(false);
  const inFlight = useRef(false);
  const lifetime = useRef({ active: false });
  useEffect(() => {
    const run = { active: true }; lifetime.current = run;
    return () => { run.active = false; };
  }, []);
  const update = async () => {
    if (inFlight.current) return;
    const run = lifetime.current;
    inFlight.current = true; setUpdating(true); setUpdateFailed(false);
    try {
      const fetched = await fetchAppUpdatePolicy(Platform.OS);
      if (!run.active) return;
      const opened = await openStore(fetched.ok ? fetched.policy : null, DeviceInfo.getBundleId());
      if (run.active) setUpdateFailed(!opened);
    } catch { if (run.active) setUpdateFailed(true); }
    finally { inFlight.current = false; if (run.active) setUpdating(false); }
  };
  return (
    <ScrollView contentContainerStyle={styles.container} testID="terms-unavailable">
      <JupleBrandMark size="medium" style={styles.brand} />
      <Text style={styles.message}>{t('agreement.loadFailed')}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry} testID="terms-unavailable-retry">
        <Text style={styles.retryLabel}>{t('auth.retry')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut} testID="terms-unavailable-signout">
        <Text style={styles.signOutLabel}>{t('auth.logout')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={updating} onPress={update} style={styles.signOut} testID="terms-unavailable-update">
        <Text style={styles.signOutLabel}>{t('appUpdate.action')}</Text>
      </Pressable>
      {updateFailed ? <Text accessibilityRole="alert" style={styles.message}>{t('appUpdate.openStoreFailed')}</Text> : null}
      <SubscriptionRights />
    </ScrollView>
  );
}

const styles = themedStyles(() => ({
  container: { alignItems: 'center', backgroundColor: colors.surface, flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  brand: { marginBottom: spacing.xl },
  message: { color: colors.textPrimary, fontSize: 16, textAlign: 'center' },
  retry: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.xl, justifyContent: 'center', marginTop: spacing.xl, minHeight: minTouchTarget, paddingHorizontal: spacing.xl },
  retryLabel: { color: colors.onBrand, fontSize: 16, fontWeight: '700' },
  signOut: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.md, minHeight: minTouchTarget, paddingHorizontal: spacing.xl },
  signOutLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
}));
