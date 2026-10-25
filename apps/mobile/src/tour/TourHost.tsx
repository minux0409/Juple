import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, BackHandler, Pressable, ScrollView, Text, View, useWindowDimensions, type HostInstance } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { navigationRef } from '../navigation/navigationRef';
import { cardShadow, colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import { cancelTour, endTour, getActiveTour, goToTourStep, subscribeTour, type ActiveTour } from './tourController';
import { cornerWedges, placeCard, sameRect, spotlightFor, spotlightRadius, TOUR_EDGE, type TourRect, type TourSize } from './tourPlacement';
import { getTourTargetRadius, measureTourTarget, subscribeTourTargetLayout } from './tourTargets';

const CARD_MAX_WIDTH = 360;
const FIND_ATTEMPTS = 20;
const FIND_INTERVAL_MS = 100;
const SETTLE_MS = 400;
const FADE_MS = 180;

/**
 * Mounted once beside the navigator. Renders nothing until a tour starts (tourController.startTour), then draws, over the whole
 * app, the dimmed screen, the spotlight around the current step's target and the explanation card. It is plain Views in the app's
 * own tree - no native module and no Modal - so it follows the app's theme and fonts, and positions itself relative to its own
 * on-screen origin (a status/navigation bar offset cannot shift the spotlight).
 */
export function TourHost() {
  const tour = useSyncExternalStore(subscribeTour, getActiveTour, getActiveTour);
  // Signing out (or anything else that removes the app behind) must not leave a half-finished tour for the next person; nothing is recorded.
  useEffect(() => cancelTour, []);
  return tour ? <TourOverlay key={tour.guide.id} tour={tour} /> : null;
}

function TourOverlay({ tour }: { readonly tour: ActiveTour }) {
  const { t } = useTranslation();
  useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const step = tour.guide.steps[tour.index];
  const total = tour.guide.steps.length;
  const isFirst = tour.index === 0;
  const isLast = tour.index === total - 1;

  const rootRef = useRef<HostInstance>(null);
  const [container, setContainer] = useState<(TourSize & { readonly originX: number; readonly originY: number }) | null>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [cardSize, setCardSize] = useState<TourSize | null>(null);
  const [missing, setMissing] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  // The overlay's own origin in the window; the targets are measured in window coordinates.
  const measureContainer = useCallback(() => {
    rootRef.current?.measureInWindow((originX, originY, width, height) => {
      if (width > 0 && height > 0) {
        setContainer(current =>
          current && current.originX === originX && current.originY === originY && current.width === width && current.height === height
            ? current
            : { originX, originY, width, height },
        );
      }
    });
  }, []);

  useEffect(() => {
    measureContainer();
  }, [measureContainer]);

  // Enter a step: go where it lives, then look for its target (a screen may need a moment to mount). A target that never shows up
  // does not end the tour: the explanation is shown centred, without a spotlight.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setRect(null);
    setMissing(false);
    fade.setValue(0);
    if (step.goTo && navigationRef.isReady()) {
      if ('tab' in step.goTo) {
        navigationRef.navigate('MainTabs', { screen: step.goTo.tab });
      } else {
        navigationRef.navigate(step.goTo.screen);
      }
    }
    const targetId = step.targetId;
    if (targetId) {
      let attempts = 0;
      const find = () => {
        measureTourTarget(targetId)
          .then(found => {
            if (!active) {
              return;
            }
            if (found) {
              setRect(found);
            } else if (++attempts < FIND_ATTEMPTS) {
              timer = setTimeout(find, FIND_INTERVAL_MS);
            } else {
              setMissing(true);
            }
          })
          .catch(() => undefined);
      };
      find();
    }
    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [fade, step]);

  // Follow the target without polling: re-measure only when the target reports a layout change, when the window changes size
  // (rotation, split screen, font scale) and once shortly after it is first found (late layout of the screen behind). One measure at
  // a time; a request that arrives while one is running is folded into a single follow-up.
  const targetId = step.targetId;
  const found = rect !== null;
  useEffect(() => {
    if (!targetId || !found) {
      return undefined;
    }
    let active = true;
    let inFlight = false;
    let again = false;
    const remeasure = () => {
      if (inFlight) {
        again = true;
        return;
      }
      inFlight = true;
      measureContainer();
      measureTourTarget(targetId)
        .then(next => {
          if (active && next) {
            setRect(current => (sameRect(current, next) ? current : next));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          if (again && active) {
            again = false;
            remeasure();
          }
        });
    };
    const unsubscribe = subscribeTourTargetLayout(targetId, remeasure);
    const settle = setTimeout(remeasure, SETTLE_MS);
    return () => {
      active = false;
      clearTimeout(settle);
      unsubscribe();
    };
  }, [measureContainer, targetId, found, windowWidth, windowHeight]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      endTour();
      return true;
    });
    return () => subscription.remove();
  }, []);

  const title = t(`tour.steps.${step.key}.title`);
  const body = t(`tour.steps.${step.key}.body`);
  const progress = t('tutorial.progress', { current: tour.index + 1, total });

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${progress}. ${title}. ${body}`);
  }, [body, progress, title]);

  const waitingForTarget = step.targetId !== undefined && rect === null && !missing;
  const spotlight = container && rect ? spotlightFor({ ...rect, x: rect.x - container.originX, y: rect.y - container.originY }, container) : null;
  // ONE radius for the ring and the dimmed area's corners (the target's own radius + the padding, clamped to a pill).
  const spotlightCornerRadius = spotlight ? spotlightRadius(step.targetId ? getTourTargetRadius(step.targetId) : undefined, spotlight) : 0;
  const cardWidth = Math.min(CARD_MAX_WIDTH, Math.max(0, (container?.width ?? windowWidth) - 2 * TOUR_EDGE));
  const placement = container && cardSize ? placeCard(spotlight, container, cardSize) : null;

  const ready = placement !== null && !waitingForTarget;
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (reduceMotion) {
      fade.setValue(1);
      return;
    }
    Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
  }, [fade, ready, reduceMotion, tour.index]);

  const cardOpacity = { opacity: ready ? fade : 0 };
  const interactive = step.interaction === 'passThrough';

  return (
    <View accessibilityViewIsModal collapsable={false} onLayout={measureContainer} pointerEvents="box-none" ref={rootRef} style={styles.root} testID="tour-overlay">
      {container && spotlight ? (
        <>
          <View style={[styles.scrim, styles.scrimTop, { height: spotlight.y }]} />
          <View style={[styles.scrim, styles.scrimBottom, { top: spotlight.y + spotlight.height }]} />
          <View style={[styles.scrim, styles.scrimLeft, { height: spotlight.height, top: spotlight.y, width: spotlight.x }]} />
          <View style={[styles.scrim, styles.scrimRight, { height: spotlight.height, left: spotlight.x + spotlight.width, top: spotlight.y }]} />
          <View
            pointerEvents="none"
            style={[styles.spotlightRing, { borderRadius: spotlightCornerRadius, height: spotlight.height, left: spotlight.x, top: spotlight.y, width: spotlight.width }]}
            testID="tour-spotlight"
          />
          {cornerWedges(spotlight, spotlightCornerRadius).map(wedge => (
            <View key={wedge.corner} pointerEvents="none" style={[styles.wedgeBox, { height: wedge.box.height, left: wedge.box.x, top: wedge.box.y, width: wedge.box.width }]} testID={`tour-corner-${wedge.corner}`}>
              <View style={[styles.wedgeRing, { borderRadius: wedge.ring.size / 2, borderWidth: wedge.ring.size / 4, height: wedge.ring.size, left: wedge.ring.left, top: wedge.ring.top, width: wedge.ring.size }]} />
            </View>
          ))}
          {interactive ? null : <View style={[styles.hole, { height: spotlight.height, left: spotlight.x, top: spotlight.y, width: spotlight.width }]} />}
        </>
      ) : (
        <View style={[styles.scrim, styles.fill]} />
      )}
      <Animated.View
        accessibilityLiveRegion="polite"
        accessible={false}
        onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setCardSize(current => (current && Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height }));
        }}
        style={[
          styles.card,
          { maxHeight: Math.max(160, (container?.height ?? 600) - 2 * TOUR_EDGE), width: cardWidth },
          placement ? { left: placement.left, top: placement.top } : { left: TOUR_EDGE, top: TOUR_EDGE },
          cardOpacity,
        ]}
        testID="tour-card"
      >
        <Text style={styles.progress} testID="tour-progress">{progress}</Text>
        <ScrollView bounces={false} style={styles.textScroll}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </ScrollView>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => endTour()} style={styles.skipButton} testID="tour-skip">
            <Text numberOfLines={2} style={styles.skipLabel}>{t('tutorial.skip')}</Text>
          </Pressable>
          <View style={styles.navButtons}>
            {isFirst ? null : (
              <Pressable accessibilityRole="button" onPress={() => goToTourStep(tour.index - 1)} style={styles.secondaryButton} testID="tour-previous">
                <Text numberOfLines={2} style={styles.secondaryLabel}>{t('tour.previous')}</Text>
              </Pressable>
            )}
            <Pressable accessibilityRole="button" onPress={() => (isLast ? endTour() : goToTourStep(tour.index + 1))} style={styles.primaryButton} testID="tour-next">
              <Text numberOfLines={2} style={styles.primaryLabel}>{isLast ? t('tour.done') : t('tutorial.next')}</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() => ({
  root: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  fill: { bottom: 0, left: 0, right: 0, top: 0 },
  scrim: { backgroundColor: colors.scrim, position: 'absolute' },
  scrimTop: { left: 0, right: 0, top: 0 },
  scrimBottom: { bottom: 0, left: 0, right: 0 },
  scrimLeft: { left: 0 },
  scrimRight: { right: 0 },
  hole: { position: 'absolute' },
  wedgeBox: { overflow: 'hidden', position: 'absolute' },
  wedgeRing: { borderColor: colors.scrim, position: 'absolute' },
  spotlightRing: { borderColor: colors.brandText, borderRadius: radii.md, borderWidth: 2, position: 'absolute' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, padding: spacing.lg, position: 'absolute', rowGap: spacing.sm, ...cardShadow, elevation: 4, shadowOpacity: 0.16, shadowRadius: 8 },
  progress: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  textScroll: { flexGrow: 0, flexShrink: 1 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: spacing.xs },
  actions: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing.xs },
  navButtons: { columnGap: spacing.sm, flexDirection: 'row', flexShrink: 1 },
  skipButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.sm },
  skipLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  secondaryButton: { alignItems: 'center', borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.lg },
  primaryLabel: { color: colors.onBrand, fontSize: 14, fontWeight: '700', textAlign: 'center' },
}));
