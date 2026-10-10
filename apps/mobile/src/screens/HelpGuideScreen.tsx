import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { GUIDE_SECTIONS } from '../help/guideContent';
import { ChevronIcon } from '../icons/ChevronIcon';
import { useLayoutDirection } from '../i18n/layoutDirection';
import type { RootStackParamList } from '../navigation/RootStack';
import { cardShadow, colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/**
 * 도움말: the revisitable Feature Guide's home. A list of goal-based sections (each opens its own scrollable page) and a
 * way to replay the first-run introduction. Static, bundled content - works offline; it reads and records nothing.
 */
export function HelpGuideScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const direction = useLayoutDirection();
  const chevronDirection = direction === 'rtl' ? 'left' : 'right';

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {GUIDE_SECTIONS.map((section, index) => {
            const Icon = section.icon;
            return (
              <View key={section.id}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('HelpGuideSection', { sectionId: section.id })}
                  style={styles.row}
                  testID={`guide-section-${section.id}`}
                >
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.rowIcon}>
                    <Icon color={colors.brand} size={20} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{t(`guide.sections.${section.id}.title`)}</Text>
                    <Text style={styles.rowSummary}>{t(`guide.sections.${section.id}.summary`)}</Text>
                  </View>
                  <ChevronIcon color={colors.textSecondary} direction={chevronDirection} size={18} />
                </Pressable>
              </View>
            );
          })}
        </View>
        <View style={[styles.card, styles.replayCard]}>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Tutorial', { mode: 'replay' })} style={styles.row} testID="guide-replay-tutorial">
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('guide.replayTutorial')}</Text>
            </View>
            <ChevronIcon color={colors.textSecondary} direction={chevronDirection} size={18} />
          </Pressable>
        </View>
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', ...cardShadow },
  replayCard: { marginTop: spacing.lg },
  divider: { backgroundColor: colors.divider, height: 1, marginHorizontal: spacing.md },
  row: { alignItems: 'center', columnGap: spacing.md, flexDirection: 'row', minHeight: minTouchTarget + 12, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  rowIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radii.md, height: 36, justifyContent: 'center', width: 36 },
  rowText: { flex: 1, flexShrink: 1 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowSummary: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
