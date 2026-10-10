import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { TutorialIllustration } from './TutorialIllustration';
import type { TutorialPageDefinition } from './tutorialPages';

/**
 * One tutorial page: a simplified Juple mini-UI (decorative, hidden from screen readers), the title and the
 * description. Reads title first, then description.
 */
export function TutorialPage({ page }: { readonly page: TutorialPageDefinition }) {
  const { t } = useTranslation();
  return (
    <View style={styles.page} testID={`tutorial-page-${page.id}`}>
      <View style={styles.illustration}>
        <TutorialIllustration pageId={page.id} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>{t(`tutorial.pages.${page.id}.title`)}</Text>
      <Text style={styles.description}>{t(`tutorial.pages.${page.id}.description`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, width: '100%' },
  illustration: { alignSelf: 'stretch', marginBottom: spacing.xl },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: spacing.md, maxWidth: 420, textAlign: 'center' },
});
