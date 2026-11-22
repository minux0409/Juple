import { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from '../components/Pressable';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

const path = '/api/v1/billing/subscription-management';

/** Existing account purchases only; never initializes a trial or opens a purchase sheet. */
export function SubscriptionRights() {
  const request = useAuthenticatedApi();
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loaded, setOwned] = useState<{ request: typeof request; value: { state: string; currentPeriodEndsAtUtc: string | null } } | null>(null);
  const owned = loaded?.request === request ? loaded.value : null;
  const inFlight = useRef(false);
  const lifetime = useRef({ active: false });
  useEffect(() => {
    const run = { active: true }; lifetime.current = run;
    inFlight.current = false; setBusy(false); setMessage('');
    return () => { run.active = false; };
  }, [request]);
  const run = async (platform?: 'google' | 'apple') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const scope = lifetime.current;
    try {
      if (platform) {
        const result = await request<{ outcome: string }>({ method: 'POST', path: `${path}/restore/${platform}` });
        if (!result.body || !['Restored', 'NothingFound'].includes(result.body.outcome)) throw new Error('restore failed');
        if (!scope.active) return;
        setMessage(t(result.body.outcome === 'Restored' ? 'subscription.restoreResult.restored' : 'subscription.restoreResult.nothingFound'));
      }
      const response = await request<{ state: string; currentPeriodEndsAtUtc: string | null }>({ method: 'GET', path });
      if (!response.body || typeof response.body.state !== 'string') throw new Error('invalid ownership');
      if (scope.active) setOwned({ request, value: response.body });
    } catch { if (scope.active) setMessage(t('subscription.restoreResult.temporary')); }
    finally { if (scope.active) { setBusy(false); inFlight.current = false; } }
  };
  const manage = async (url: string) => {
    const scope = lifetime.current;
    try { await Linking.openURL(url); }
    catch { if (scope.active) setMessage(t('subscription.manageFailed')); }
  };
  const stateKey = owned?.state === 'Active' ? 'active' : owned?.state === 'Canceled' ? 'canceled' : owned?.state === 'Revoked' ? 'revoked' : owned?.state === 'GracePeriod' ? 'gracePeriod' : owned?.state === 'Expired' ? 'expired' : owned?.state === 'None' ? 'none' : 'unknown';
  return <View style={styles.panel} testID="terms-subscription-rights">
    <Text style={styles.text} accessibilityRole="header">{t('subscription.manage')}</Text>
    {owned ? <Text style={styles.text}>{t(`subscription.status.${stateKey}`)}{owned.currentPeriodEndsAtUtc ? ` · ${new Date(owned.currentPeriodEndsAtUtc).toLocaleString(i18n.resolvedLanguage)}` : ''}</Text> : null}
    {message ? <Text style={styles.text} accessibilityRole="alert">{message}</Text> : null}
    <Pressable style={styles.button} accessibilityRole="button" testID="terms-subscription-status" disabled={busy} onPress={() => run()}><Text style={styles.text}>{t('subscription.stateHeading')}</Text></Pressable>
    <Pressable style={styles.button} accessibilityRole="button" testID="terms-restore-google" disabled={busy} onPress={() => run('google')}><Text style={styles.text}>{t('subscription.restore')} · Google Play</Text></Pressable>
    <Pressable style={styles.button} accessibilityRole="button" testID="terms-restore-apple" disabled={busy} onPress={() => run('apple')}><Text style={styles.text}>{t('subscription.restore')} · App Store</Text></Pressable>
    <Pressable style={styles.button} accessibilityRole="link" onPress={() => manage('https://play.google.com/store/account/subscriptions')}><Text style={styles.text}>Google Play · {t('subscription.manage')}</Text></Pressable>
    <Pressable style={styles.button} accessibilityRole="link" onPress={() => manage('https://apps.apple.com/account/subscriptions')}><Text style={styles.text}>App Store · {t('subscription.manage')}</Text></Pressable>
  </View>;
}

const styles = themedStyles(() => ({
  panel: { marginTop: spacing.xl, paddingBottom: spacing.lg, width: '100%', gap: spacing.sm },
  button: { minHeight: minTouchTarget, justifyContent: 'center', paddingVertical: spacing.sm },
  text: { color: colors.textPrimary, flexShrink: 1 },
}));
