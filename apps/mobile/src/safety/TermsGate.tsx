import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { useAuth } from '../auth/AuthContext';
import { AppModal } from '../components/AppModal';
import { legalLinks } from '../config/legalLinks';
import { CheckIcon } from '../icons/CheckIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { acceptTerms, getTermsStatus, type TermsStatus } from './safetyApi';
import { onTermsAcceptanceRequired } from './termsRequiredEvents';

/**
 * A UGC write requests consent here immediately before submission. Startup and private work remain usable.
 * The server is the source of truth; a 403 caused by a newer version reopens this dialog and retries once.
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
  const pending = useRef<((accepted: boolean) => void) | null>(null);

  useEffect(() => {
    if (!ready) {
      setStatus(null);
      setVisible(false);
      pending.current?.(false);
      pending.current = null;
      return undefined;
    }
    return undefined;
  }, [ready]);

  useEffect(
    () =>
      onTermsAcceptanceRequired((resolve, refresh) => {
        if (!ready || pending.current) {
          resolve(false);
          return;
        }
        pending.current = resolve;
        setAgreed(false);
        setFailed(false);
        const check = refresh || !status ? getTermsStatus(request) : Promise.resolve(status);
        check.then(next => {
          if (pending.current !== resolve) {
            return;
          }
          if (!next || next.isAccepted) {
            pending.current = null;
            if (next) {
              setStatus(next);
            }
            resolve(Boolean(next?.isAccepted));
          } else {
            setStatus(next);
            setVisible(true);
          }
        }).catch(() => {
          pending.current = null;
          resolve(false);
        });
      }),
    [ready, request, status],
  );

  useEffect(() => () => {
    pending.current?.(false);
    pending.current = null;
  }, []);

  const cancel = useCallback(() => {
    setVisible(false);
    pending.current?.(false);
    pending.current = null;
  }, []);

  const accept = useCallback(async () => {
    if (!status || !agreed || isSaving) {
      return;
    }
    setIsSaving(true);
    setFailed(false);
    try {
      const accepted = await acceptTerms(request, status.currentVersion);
      setStatus(accepted);
      if (!accepted.isAccepted) {
        setFailed(true);
        return;
      }
      setVisible(false);
      pending.current?.(true);
      pending.current = null;
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
          <Pressable accessibilityRole="button" disabled={isSaving} onPress={cancel} style={[styles.button, styles.later]} testID="terms-later">
            <Text style={styles.laterLabel}>{t('common.cancel')}</Text>
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
      onClose={cancel}
      testID="terms-gate"
      title={t('safety.termsTitle')}
      visible
    >
      <ScrollView style={styles.contentScroll}>
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
      </ScrollView>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  contentScroll: { flexShrink: 1 },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  link: { justifyContent: 'center', minHeight: minTouchTarget },
  linkLabel: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  agree: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, minHeight: minTouchTarget },
  agreeLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 15, fontWeight: '600' },
  box: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 },
  boxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  footer: { alignSelf: 'stretch', flexDirection: 'column-reverse', gap: spacing.sm, width: '100%' },
  button: { alignItems: 'center', borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md, width: '100%' },
  later: { borderColor: colors.border, borderWidth: 1 },
  laterLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  accept: { backgroundColor: colors.brand },
  acceptLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 },
});
