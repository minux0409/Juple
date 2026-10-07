import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackHandler, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CloseIcon } from '../icons/CloseIcon';
import { useLayoutDirection } from '../i18n/layoutDirection';
import type { RootStackParamList } from '../navigation/RootStack';
import { markTutorialCompleted } from '../settings/tutorialPreference';
import { TutorialPage } from '../support/TutorialPage';
import { TUTORIAL_PAGES } from '../support/tutorialPages';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

const SWIPE_DISTANCE = 50;

/**
 * The tutorial, one screen for both uses: `firstRun` (shown once after sign-in; 건너뛰기, 시작하기 and Android back all
 * record that this tutorial version is done) and `replay` (from 고객센터; closing it records nothing and returns to
 * where it was opened). Pages are bundled static content. Next / swipe move between pages; a page that is too tall
 * for a small screen or a long translation scrolls, with the buttons always in reach.
 */
export function TutorialScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Tutorial'>>();
  const params = route.params;
  const direction = useLayoutDirection();
  const [pageIndex, setPageIndex] = useState(0);
  const isLastPage = pageIndex === TUTORIAL_PAGES.length - 1;
  const isFinishing = useRef(false);

  const finish = useCallback(() => {
    if (isFinishing.current) {
      return;
    }
    isFinishing.current = true;
    if (params.mode === 'firstRun') {
      markTutorialCompleted(params.userKey).catch(() => undefined);
    }
    navigation.goBack();
  }, [navigation, params]);

  // Android back is Skip (first run) / close (replay) - never a way to see the same tutorial again next launch.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      finish();
      return true;
    });
    return () => subscription.remove();
  }, [finish]);

  const goTo = useCallback((next: number) => setPageIndex(Math.max(0, Math.min(TUTORIAL_PAGES.length - 1, next))), []);

  // Horizontal swipe between pages, only when the gesture is clearly horizontal (a page's own vertical scroll is untouched).
  const pageIndexRef = useRef(pageIndex);
  pageIndexRef.current = pageIndex;
  const swipe = useMemo(
    () => PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (Math.abs(gesture.dx) < SWIPE_DISTANCE) {
          return;
        }
        // Content moves the way the finger does: left reveals the next page in LTR, the previous one in RTL.
        const towardsNext = direction === 'rtl' ? gesture.dx > 0 : gesture.dx < 0;
        goTo(pageIndexRef.current + (towardsNext ? 1 : -1));
      },
    }),
    [direction, goTo],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID="tutorial-screen">
      <View style={styles.topBar}>
        {params.mode === 'firstRun' ? (
          <Pressable accessibilityRole="button" onPress={finish} style={styles.skipButton} testID="tutorial-skip">
            <Text numberOfLines={1} style={styles.skipLabel}>{t('tutorial.skip')}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityLabel={t('tutorial.close')} accessibilityRole="button" onPress={finish} style={styles.skipButton} testID="tutorial-close">
            <CloseIcon color={colors.textSecondary} size={22} />
          </Pressable>
        )}
      </View>
      <View style={styles.body} {...swipe.panHandlers}>
        <ScrollView contentContainerStyle={styles.pageContent} key={pageIndex} testID="tutorial-scroll">
          <TutorialPage page={TUTORIAL_PAGES[pageIndex]} />
        </ScrollView>
      </View>
      <View style={styles.footer}>
        {/* One announcement for the whole indicator ("2 / 5"), not one per dot. */}
        <View accessibilityLabel={t('tutorial.progress', { current: pageIndex + 1, total: TUTORIAL_PAGES.length })} accessible style={styles.dots} testID="tutorial-progress">
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dotsRow}>
            {TUTORIAL_PAGES.map((page, index) => (
              <View key={page.id} style={[styles.dot, index === pageIndex && styles.dotActive]} />
            ))}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => (isLastPage ? finish() : goTo(pageIndex + 1))}
          style={styles.primaryButton}
          testID="tutorial-next"
        >
          <Text numberOfLines={2} style={styles.primaryLabel}>{isLastPage ? t('tutorial.start') : t('tutorial.next')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  topBar: { alignItems: 'flex-end', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  skipButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.sm },
  skipLabel: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  body: { flex: 1 },
  pageContent: { alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  footer: { alignItems: 'center', alignSelf: 'center', maxWidth: 480, padding: spacing.xl, paddingTop: spacing.md, rowGap: spacing.lg, width: '100%' },
  dots: { alignItems: 'center', minHeight: 20, justifyContent: 'center' },
  dotsRow: { columnGap: spacing.sm, flexDirection: 'row' },
  dot: { backgroundColor: colors.inputBorder, borderRadius: 4, height: 8, width: 8 },
  dotActive: { backgroundColor: colors.brand, width: 22 },
  primaryButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget + 4, paddingHorizontal: spacing.lg },
  primaryLabel: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
});
