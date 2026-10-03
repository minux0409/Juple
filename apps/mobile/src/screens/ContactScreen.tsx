import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CopyIconButton } from '../components/CopyIconButton';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useMessageDialog } from '../components/useMessageDialog';
import { CONTACT_EMAIL } from '../config/contactConfig';
import { cardShadow, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * 문의하기: a short explanation, the support address and one button that opens the system mail app
 * (`mailto:` with a prefilled subject). Deliberately no form of its own and no mail backend - the
 * person writes in their own mail app. Without any mail app the failure is said in the shared
 * message dialog, the address stays on screen and can be copied.
 */
export function ContactScreen() {
  const { t } = useTranslation();
  const { showMessage, messageDialog } = useMessageDialog();

  // No canOpenURL pre-check: on Android 11+ package visibility can make it return false for a handler
  // that openURL would find. A real failure (no mail app at all) surfaces through the catch.
  const sendEmail = async () => {
    const url = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('contact.subject'))}`;
    try {
      await Linking.openURL(url);
    } catch {
      showMessage(t('contact.noMailApp', { email: CONTACT_EMAIL }));
    }
  };

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.description}>{t('contact.description')}</Text>
          <View style={styles.emailRow}>
            <Text numberOfLines={1} selectable style={[styles.email, ltrTextStyle]} testID="contact-email">{CONTACT_EMAIL}</Text>
            <CopyIconButton accessibilityLabel={t('contact.copyEmail')} testID="contact-copy-email" text={CONTACT_EMAIL} />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              sendEmail().catch(() => undefined);
            }}
            style={styles.sendButton}
            testID="contact-send"
          >
            <Text numberOfLines={2} style={styles.sendLabel}>{t('contact.sendEmail')}</Text>
          </Pressable>
        </View>
      </ScrollView>
      {messageDialog}
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, ...cardShadow },
  description: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  emailRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  email: { color: colors.textPrimary, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.lg,
  },
  sendLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
