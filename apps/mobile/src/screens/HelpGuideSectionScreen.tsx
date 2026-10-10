import { useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { findGuideSection, type GuideRequirement } from '../help/guideContent';
import type { RootStackParamList } from '../navigation/RootStack';
import { useCollectionShortcutSupport } from '../shortcuts/useCollectionShortcutSupport';
import { cardShadow, colors, radii, spacing } from '../theme/tokens';

/**
 * One Help Guide section: its topics as short cards. A topic (or an extra paragraph) that needs a device capability is
 * rendered only when `useCollectionShortcutSupport` - the Collection menu's own source - says it is available; while
 * that is still unknown, or when it is not supported, it is simply omitted.
 */
export function HelpGuideSectionScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<RootStackParamList, 'HelpGuideSection'>>();
  const section = findGuideSection(route.params.sectionId);
  const { directShareSupported, homePinSupport } = useCollectionShortcutSupport({ resolveOnMount: true });

  const isAvailable = (requirement: GuideRequirement | undefined): boolean => {
    if (requirement === 'directShare') {
      return directShareSupported;
    }
    if (requirement === 'homePin') {
      return homePinSupport === 'supported';
    }
    return true;
  };

  if (!section) {
    return <StackScreenSafeArea style={styles.safeArea}><View /></StackScreenSafeArea>;
  }

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} testID="guide-section-scroll">
        {section.topics.filter(topic => isAvailable(topic.requires)).map(topic => {
          const paragraphs = t(`guide.topics.${topic.id}.body`).split('\n\n');
          if (topic.extra && isAvailable(topic.extra.requires)) {
            paragraphs.push(...t(`guide.topics.${topic.id}.${topic.extra.key}`).split('\n\n'));
          }
          return (
            <View key={topic.id} style={styles.card} testID={`guide-topic-${topic.id}`}>
              <Text accessibilityRole="header" style={styles.topicTitle}>{t(`guide.topics.${topic.id}.title`)}</Text>
              {paragraphs.map((paragraph, index) => (
                <Text key={index} style={styles.paragraph}>{paragraph}</Text>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </StackScreenSafeArea>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.xl, paddingTop: spacing.lg, rowGap: spacing.md, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, rowGap: spacing.sm, ...cardShadow },
  topicTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  paragraph: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },
});
