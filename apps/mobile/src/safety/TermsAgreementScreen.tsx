import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppModal } from '../components/AppModal';
import { legalLinks } from '../config/legalLinks';
import { ChevronIcon } from '../icons/ChevronIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

type Document = 'terms' | 'privacy';

interface TermsAgreementScreenProps {
  readonly isSaving: boolean;
  readonly saveFailed: boolean;
  /** Both required agreements were given: the screen's 다음. */
  readonly onAccept: () => void;
  /** X: leave WITHOUT agreeing - the caller signs out; nothing past this screen opens. */
  readonly onClose: () => void;
}

/**
 * The first screen after a successful sign-in until the CURRENT Terms are accepted (before the tutorial and Home). Two required
 * agreements - the Terms of Service and the collection and use of personal information - each with its detail; "all" checks both.
 * There is no skip: 다음 stays disabled until both are checked, and X signs out. One acceptance (the Terms version) is recorded
 * by the server for the account, so another device or a later sign-in never asks again.
 */
export function TermsAgreementScreen({ isSaving, saveFailed, onAccept, onClose }: TermsAgreementScreenProps) {
  const { t } = useTranslation();
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [detail, setDetail] = useState<Document | null>(null);
  const allChecked = termsChecked && privacyChecked;

  const toggleAll = () => {
    const next = !allChecked;
    setTermsChecked(next);
    setPrivacyChecked(next);
  };

  const openFull = (url: string | null) => {
    if (url) {
      Linking.openURL(url).catch(() => undefined);
    }
  };

  return (
    <SafeAreaView style={styles.screen} testID="terms-agreement-screen">
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={t('agreement.close')}
          accessibilityRole="button"
          disabled={isSaving}
          hitSlop={8}
          onPress={onClose}
          style={styles.closeButton}
          testID="agreement-close"
        >
          <CloseIcon color={colors.textPrimary} size={24} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        <Text style={[styles.brand, ltrTextStyle]}>Juple</Text>
        <Text accessibilityRole="header" style={styles.title}>{t('agreement.title')}</Text>
        <Text style={styles.subtitle}>{t('agreement.subtitle')}</Text>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allChecked, disabled: isSaving }}
          disabled={isSaving}
          onPress={toggleAll}
          style={[styles.row, styles.allRow]}
          testID="agreement-all"
        >
          <View style={[styles.box, allChecked && styles.boxChecked]}>{allChecked ? <CheckIcon color={colors.surface} size={14} /> : null}</View>
          <Text style={styles.allLabel}>{t('agreement.agreeAll')}</Text>
        </Pressable>

        <View style={styles.divider} />

        <AgreementRow
          checked={termsChecked}
          detailLabel={t('agreement.viewDetail')}
          disabled={isSaving}
          label={t('agreement.required', { name: t('agreement.termsName') })}
          onDetail={() => setDetail('terms')}
          onToggle={() => setTermsChecked(value => !value)}
          testID="agreement-terms"
        />
        <AgreementRow
          checked={privacyChecked}
          detailLabel={t('agreement.viewDetail')}
          disabled={isSaving}
          label={t('agreement.required', { name: t('agreement.privacyName') })}
          onDetail={() => setDetail('privacy')}
          onToggle={() => setPrivacyChecked(value => !value)}
          testID="agreement-privacy"
        />

        {saveFailed ? (
          <Text accessibilityLiveRegion="polite" style={styles.error} testID="agreement-error">{t('safety.termsSaveFailed')}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !allChecked || isSaving, busy: isSaving }}
          disabled={!allChecked || isSaving}
          onPress={onAccept}
          style={[styles.next, (!allChecked || isSaving) && styles.nextDisabled]}
          testID="agreement-next"
        >
          {isSaving ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.nextLabel}>{t('agreement.next')}</Text>}
        </Pressable>
      </View>

      <AppModal
        onClose={() => setDetail(null)}
        size="large"
        testID="agreement-detail"
        title={detail === 'privacy' ? t('agreement.privacyName') : t('agreement.termsName')}
        visible={detail !== null}
        footer={
          <Pressable
            accessibilityRole="link"
            onPress={() => openFull(detail === 'privacy' ? legalLinks.privacyUrl : legalLinks.termsUrl)}
            style={styles.fullLink}
            testID="agreement-detail-full"
          >
            <Text style={styles.fullLinkLabel}>{detail === 'privacy' ? t('safety.termsViewPrivacy') : t('safety.termsViewTerms')}</Text>
          </Pressable>
        }
      >
        <ScrollView style={styles.detailScroll}>
          {detail === 'privacy' ? <PrivacyDetail /> : <TermsDetail />}
        </ScrollView>
      </AppModal>
    </SafeAreaView>
  );
}

function AgreementRow({
  checked,
  disabled,
  label,
  detailLabel,
  onToggle,
  onDetail,
  testID,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly detailLabel: string;
  readonly onToggle: () => void;
  readonly onDetail: () => void;
  readonly testID: string;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        disabled={disabled}
        onPress={onToggle}
        style={styles.rowMain}
        testID={testID}
      >
        <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <CheckIcon color={colors.surface} size={14} /> : null}</View>
        <Text style={styles.rowLabel}>{label}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={detailLabel}
        accessibilityRole="button"
        disabled={disabled}
        hitSlop={8}
        onPress={onDetail}
        style={styles.detailButton}
        testID={`${testID}-detail`}
      >
        <ChevronIcon color={colors.textSecondary} direction="right" size={20} />
      </Pressable>
    </View>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

function TermsDetail() {
  const { t } = useTranslation();
  return (
    <View>
      <Section title={t('agreement.terms.serviceTitle')}>{t('agreement.terms.serviceBody')}</Section>
      <Section title={t('agreement.terms.contentTitle')}>{t('agreement.terms.contentBody')}</Section>
      <Section title={t('agreement.terms.conductTitle')}>{t('agreement.terms.conductBody')}</Section>
      <Section title={t('agreement.terms.reportTitle')}>{t('agreement.terms.reportBody')}</Section>
      <Section title={t('agreement.terms.restrictionTitle')}>{t('agreement.terms.restrictionBody')}</Section>
      <Section title={t('agreement.terms.subscriptionTitle')}>{t('agreement.terms.subscriptionBody')}</Section>
    </View>
  );
}

/** The itemized collection-and-use notice: what, why, how long, and the right to refuse - the same facts as the published privacy policy. */
function PrivacyDetail() {
  const { t } = useTranslation();
  return (
    <View>
      <Section title={t('agreement.privacy.itemsTitle')}>{t('agreement.privacy.itemsBody')}</Section>
      <Section title={t('agreement.privacy.purposeTitle')}>{t('agreement.privacy.purposeBody')}</Section>
      <Section title={t('agreement.privacy.retentionTitle')}>{t('agreement.privacy.retentionBody')}</Section>
      <Section title={t('agreement.privacy.refusalTitle')}>{t('agreement.privacy.refusalBody')}</Section>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.surface, flex: 1 },
  topBar: { alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  closeButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  scroll: { flex: 1 },
  content: { alignSelf: 'center', maxWidth: 560, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, width: '100%' },
  brand: { color: colors.brand, fontSize: 28, fontWeight: '800', marginTop: spacing.md },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '800', marginTop: spacing.lg },
  subtitle: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginBottom: spacing.xl, marginTop: spacing.sm },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: minTouchTarget + 8 },
  allRow: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, paddingHorizontal: spacing.md },
  rowMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm, minHeight: minTouchTarget + 8 },
  rowLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 15, lineHeight: 21 },
  allLabel: { color: colors.textPrimary, flexShrink: 1, fontSize: 16, fontWeight: '700', marginStart: spacing.sm },
  divider: { backgroundColor: colors.divider, height: 1, marginVertical: spacing.md },
  box: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: 12, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 },
  boxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  detailButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  error: { color: colors.danger, fontSize: 14, marginTop: spacing.md },
  footer: { alignSelf: 'center', maxWidth: 560, paddingBottom: spacing.lg, paddingHorizontal: spacing.xl, width: '100%' },
  next: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.xl, justifyContent: 'center', minHeight: minTouchTarget + 8, paddingHorizontal: spacing.md },
  nextDisabled: { opacity: 0.4 },
  nextLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  detailScroll: { flexShrink: 1 },
  section: { marginBottom: spacing.md },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  sectionBody: { color: colors.textPrimary, fontSize: 14, lineHeight: 21, marginTop: spacing.xs },
  fullLink: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget },
  fullLinkLabel: { color: colors.brand, fontSize: 15, fontWeight: '600' },
});
