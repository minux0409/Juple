import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { useMessageDialog } from '../components/useMessageDialog';
import { legalLinks } from '../config/legalLinks';
import { ChevronIcon } from '../icons/ChevronIcon';
import type { RootStackParamList } from '../navigation/RootStack';
import { FaqAccordionItem } from '../support/FaqAccordionItem';
import { FAQ_TOPICS } from '../support/faqTopics';
import { getAppInfo } from '../support/appInfo';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * 고객센터: one compact page for everything about getting help - the tutorial again, the FAQ (static, bundled,
 * works offline), 문의하기 (the person's own mail app, a safe diagnostic footer, no mail backend), the legal
 * documents (rows appear only once their real URLs are configured - see config/legalLinks) and the app's own
 * version. 문의하기 opens the in-app inquiry screen (no mail app involved); a legal link that will not open is said in
 * the shared message dialog.
 */
export function CustomerCenterScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { showMessage, messageDialog } = useMessageDialog();
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const appInfo = getAppInfo();

  // No canOpenURL pre-check: on Android 11+ package visibility can make it return false for a handler that
  // openURL would find. A real failure surfaces through the catch.
  const openLegal = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showMessage(t('customerCenter.openLinkFailed'));
    }
  };

  const legalRows = [
    { id: 'terms', label: t('customerCenter.terms'), url: legalLinks.termsUrl },
    { id: 'privacy', label: t('customerCenter.privacy'), url: legalLinks.privacyUrl },
  ].filter((row): row is { id: string; label: string; url: string } => row.url !== null);

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <NavigationRow label={t('customerCenter.replayTutorial')} onPress={() => navigation.navigate('Tutorial', { mode: 'replay' })} testID="customer-center-tutorial" />
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('customerCenter.faqHeading')}</Text>
        <View style={styles.card}>
          {FAQ_TOPICS.map((topic, index) => (
            <Fragment key={topic}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <FaqAccordionItem
                answer={t(`customerCenter.faq.${topic}.answer`)}
                isExpanded={expandedTopic === topic}
                onToggle={() => setExpandedTopic(previous => (previous === topic ? null : topic))}
                question={t(`customerCenter.faq.${topic}.question`)}
                testID={`faq-${topic}`}
              />
            </Fragment>
          ))}
        </View>

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('customerCenter.inquiryHeading')}</Text>
        <View style={styles.card}>
          <NavigationRow label={t('inquiry.title')} onPress={() => navigation.navigate('SupportInquiry')} testID="customer-center-contact" />
        </View>

        {legalRows.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('customerCenter.serviceInfoHeading')}</Text>
            <View style={styles.card}>
              {legalRows.map((row, index) => (
                <Fragment key={row.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <NavigationRow label={row.label} onPress={() => { openLegal(row.url).catch(() => undefined); }} testID={`customer-center-${row.id}`} />
                </Fragment>
              ))}
            </View>
          </>
        ) : null}

        <Text accessibilityRole="header" style={styles.sectionTitle}>{t('customerCenter.appInfoHeading')}</Text>
        <View style={[styles.card, styles.appInfo]}>
          <Text style={styles.appName}>Juple</Text>
          <Text style={styles.version} testID="customer-center-version">{t('customerCenter.version', { version: appInfo.version, build: appInfo.build })}</Text>
        </View>
      </ScrollView>
      {messageDialog}
    </StackScreenSafeArea>
  );
}

function NavigationRow({ label, onPress, testID }: { readonly label: string; readonly onPress: () => void; readonly testID: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.navRow} testID={testID}>
      <Text style={styles.navLabel}>{label}</Text>
      <ChevronIcon color={colors.textSecondary} direction="right" size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.sm, marginTop: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', ...cardShadow },
  divider: { backgroundColor: colors.divider, height: 1, marginHorizontal: spacing.md },
  navRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', minHeight: minTouchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  navLabel: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '600' },
  appInfo: { padding: spacing.md },
  appName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  version: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
});
