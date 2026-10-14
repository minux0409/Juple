import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { AppModal } from '../components/AppModal';
import { legalLinks } from '../config/legalLinks';
import { CheckIcon } from '../icons/CheckIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { acceptTerms, getTermsStatus, type TermsStatus } from './safetyApi';
import { onTermsAcceptanceRequired } from './termsRequiredEvents';

/**
 * 이용약관 동의 (Google Play UGC policy): once the person is signed in and the account exists, the CURRENT Terms version is read from
 * the server; without an agreement this modal asks - Terms and Privacy Policy are links, and only the Terms are agreed to here (the
 * Privacy Policy is never bundled into this agreement). "나중에" keeps the person signed in and able to read; the server still refuses
 * every content write until the agreement exists, and that refusal opens this modal again. Nothing is stored locally: the server's
 * record is the only truth, so an accepted person is never asked twice and a new version asks again.
 */
export function TermsGate() {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const { isAuthenticated, userBootstrapStatus } = useAuth();
  const ready = isAuthenticated && userBootstrapStatus === 'ready';
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ready) {
      setStatus(null);
      setVisible(false);
      return undefined;
    }
    let isActive = true;
    getTermsStatus(request)
      .then(next => {
        if (isActive && next) {
          setStatus(next);
          setVisible(!next.isAccepted);
        }
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
    // The request function is stable per session; the status is read again for a new sign-in only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(
    () =>
      onTermsAcceptanceRequired(() => {
        setAgreed(false);
        setFailed(false);
        setVisible(true);
        // The version may have changed since the app started: read it again so the agreement is to the current one.
        getTermsStatus(request).then(next => next && setStatus(next)).catch(() => undefined);
      }),
    [request],
  );

  const accept = useCallback(async () => {
    if (!status || !agreed || isSaving) {
      return;
    }
    setIsSaving(true);
    setFailed(false);
    try {
      setStatus(await acceptTerms(request, status.currentVersion));
      setVisible(false);
    } catch {
      setFailed(true);
    } finally {
      setIsSaving(false);
    }
  }, [agreed, isSaving, request, status]);

  const open = (url: string | null) => {
    if (url) {
      Linking.openURL(url).catch(() => undefined);
    }
  };

  if (!ready || !visible) {
    return null;
  }

  return (
    <AppModal
      dismissible={!isSaving}
      footer={
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => setVisible(false)} style={[styles.button, styles.later]} testID="terms-later">
            <Text style={styles.laterLabel}>{t('safety.termsLater')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !agreed || isSaving || !status, busy: isSaving }}
            disabled={!agreed || isSaving || !status}
            onPress={() => { accept().catch(() => undefined); }}
            style={[styles.button, styles.accept, (!agreed || isSaving || !status) && styles.disabled]}
            testID="terms-accept"
          >
            {isSaving ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.acceptLabel}>{t('safety.termsContinue')}</Text>}
          </Pressable>
        </View>
      }
      onClose={() => setVisible(false)}
      testID="terms-gate"
      title={t('safety.termsTitle')}
      visible
    >
      <Text style={styles.body}>{t('safety.termsBody')}</Text>
      {legalLinks.termsUrl ? (
        <Pressable accessibilityRole="link" onPress={() => open(legalLinks.termsUrl)} style={styles.link} testID="terms-view-terms">
          <Text style={styles.linkLabel}>{t('safety.termsViewTerms')}</Text>
        </Pressable>
      ) : null}
      {legalLinks.privacyUrl ? (
        <Pressable accessibilityRole="link" onPress={() => open(legalLinks.privacyUrl)} style={styles.link} testID="terms-view-privacy">
          <Text style={styles.linkLabel}>{t('safety.termsViewPrivacy')}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed, disabled: isSaving }}
        disabled={isSaving}
        onPress={() => setAgreed(value => !value)}
        style={styles.agree}
        testID="terms-agree"
      >
        <View style={[styles.box, agreed && styles.boxChecked]}>{agreed ? <CheckIcon color={colors.surface} size={14} /> : null}</View>
        <Text style={styles.agreeLabel}>{t('safety.termsAgree')}</Text>
      </Pressable>
      {failed ? <Text accessibilityLiveRegion="polite" style={styles.error} testID="terms-error">{t('safety.termsSaveFailed')}</Text> : null}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  link: { justifyContent: 'center', minHeight: minTouchTarget },
  linkLabel: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  agree: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, minHeight: minTouchTarget },
  agreeLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 15, fontWeight: '600' },
  box: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 },
  boxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm },
  button: { alignItems: 'center', borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  later: { borderColor: colors.border, borderWidth: 1 },
  laterLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  accept: { backgroundColor: colors.brand },
  acceptLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
