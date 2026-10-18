import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { AppModal } from '../components/AppModal';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { REPORT_DETAILS_MAX_LENGTH, REPORT_REASONS, submitReport, type ReportReason, type ReportTarget } from './safetyApi';

interface ReportModalProps {
  /** Null = closed. */
  readonly target: ReportTarget | null;
  readonly onClose: () => void;
  /** The report was received (or was already open): the screen says so in its own message. */
  readonly onReported: (alreadyReported: boolean) => void;
}

/**
 * 신고: why (one of the server's reasons, nothing pre-selected), an optional explanation, send. A report goes only through the API;
 * the server decides what may be reported and answers the same for "no such thing" and "you may not see it". A failure stays in the
 * dialog with the draft kept.
 */
export function ReportModal({ target, onClose, onReported }: ReportModalProps) {
  const { t } = useTranslation();
  const request = useAuthenticatedApi();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    if (target === null) {
      setReason(null);
      setDetails('');
      setFailed(false);
      setIsSending(false);
      sending.current = false;
    }
  }, [target]);

  if (target === null) {
    return null;
  }

  const send = async () => {
    if (sending.current || reason === null) {
      return;
    }
    sending.current = true;
    setIsSending(true);
    setFailed(false);
    try {
      const receipt = await submitReport(request, target, reason, details);
      onReported(receipt.alreadyReported);
    } catch {
      setFailed(true);
    } finally {
      sending.current = false;
      setIsSending(false);
    }
  };

  const cannotSend = isSending || reason === null;

  return (
    <AppModal
      dismissible={!isSending}
      footer={
        <View style={styles.footer}>
          <Pressable accessibilityRole="button" disabled={isSending} onPress={onClose} style={[styles.button, styles.cancel]} testID="report-cancel">
            <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: cannotSend, busy: isSending }}
            disabled={cannotSend}
            onPress={() => { send().catch(() => undefined); }}
            style={[styles.button, styles.submit, cannotSend && styles.disabled]}
            testID="report-submit"
          >
            {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.submitLabel}>{t('safety.reportSubmit')}</Text>}
          </Pressable>
        </View>
      }
      onClose={onClose}
      size="large"
      testID="report-modal"
      title={t('safety.report')}
      visible
    >
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={styles.heading}>{t('safety.reportReasonTitle')}</Text>
        {REPORT_REASONS.map(candidate => {
          const selected = candidate === reason;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: isSending }}
              disabled={isSending}
              key={candidate}
              onPress={() => setReason(candidate)}
              style={[styles.reason, selected && styles.reasonSelected]}
              testID={`report-reason-${candidate}`}
            >
              <View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <View style={styles.radioDot} /> : null}</View>
              <Text style={styles.reasonLabel}>{t(`safety.reason${candidate}`)}</Text>
            </Pressable>
          );
        })}
        <ThemedTextInput
          accessibilityLabel={t('safety.reportDetailsPlaceholder')}
          editable={!isSending}
          maxLength={REPORT_DETAILS_MAX_LENGTH}
          multiline
          onChangeText={setDetails}
          placeholder={t('safety.reportDetailsPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          style={styles.details}
          testID="report-details"
          value={details}
        />
        {failed ? <Text accessibilityLiveRegion="polite" style={styles.error} testID="report-error">{t('safety.reportFailed')}</Text> : null}
      </ScrollView>
    </AppModal>
  );
}

const styles = themedStyles(() => ({
  heading: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: spacing.sm },
  reason: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs + 2, minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  reasonSelected: { borderColor: colors.brand },
  reasonLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 15 },
  radio: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 },
  radioSelected: { borderColor: colors.brand },
  radioDot: { backgroundColor: colors.brand, borderRadius: 5, height: 10, width: 10 },
  details: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md + 4, borderWidth: 1, color: colors.textPrimary, fontSize: 15, marginTop: spacing.sm, minHeight: 88, padding: spacing.md, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm },
  button: { alignItems: 'center', borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  cancel: { borderColor: colors.border, borderWidth: 1 },
  cancelLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  submit: { backgroundColor: colors.brand },
  submitLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  disabled: { opacity: 0.45 },
}));
