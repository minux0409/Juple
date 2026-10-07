import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import type { TutorialPageDefinition } from './tutorialPages';

const MAIN_ICON_SIZE = 64;
const CHIP_ICON_SIZE = 22;

/**
 * One tutorial page: a small composed illustration (Juple's own icons on soft shapes - decoration only, hidden
 * from screen readers), the title and the description. Reads title first, then description.
 */
export function TutorialPage({ page }: { readonly page: TutorialPageDefinition }) {
  const { t } = useTranslation();
  const MainIcon = page.mainIcon;
  return (
    <View style={styles.page} testID={`tutorial-page-${page.id}`}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.illustration}>
        <View style={styles.mainCircle}>
          <MainIcon color={colors.brand} size={MAIN_ICON_SIZE} />
        </View>
        <View style={styles.chips}>
          {page.chipIcons.map((Chip, index) => (
            <View key={index} style={styles.chip}>
              <Chip color={colors.textSecondary} size={CHIP_ICON_SIZE} />
            </View>
          ))}
        </View>
      </View>
      <Text accessibilityRole="header" style={styles.title}>{t(`tutorial.pages.${page.id}.title`)}</Text>
      <Text style={styles.description}>{t(`tutorial.pages.${page.id}.description`)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, width: '100%' },
  illustration: { alignItems: 'center', marginBottom: spacing.xl },
  mainCircle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.xl * 3, borderWidth: 1, height: 150, justifyContent: 'center', width: 150 },
  chips: { columnGap: spacing.sm, flexDirection: 'row', marginTop: spacing.md },
  chip: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.lg, height: 44, justifyContent: 'center', width: 44 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  description: { color: colors.textSecondary, fontSize: 15, lineHeight: 23, marginTop: spacing.md, maxWidth: 420, textAlign: 'center' },
});
