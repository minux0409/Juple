import { useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { getActiveTour, subscribeTour } from './tourController';

const styles = StyleSheet.create({ fill: { flex: 1 } });

/** Whether the running tour's current step hides the app behind it from screen readers (every step except 'passThrough'). */
export function tourHidesBackground(): boolean {
  const tour = getActiveTour();
  return tour !== null && tour.guide.steps[tour.index]?.interaction !== 'passThrough';
}

/**
 * Wraps the app behind the tour overlay. While a blocking step is shown, TalkBack and VoiceOver treat everything inside as absent
 * (Android: importantForAccessibility, iOS: accessibilityElementsHidden), so the tour card and its buttons are the only things a
 * screen reader reaches - it cannot wander to the Home input or the tabs behind the dimming. A 'passThrough' step leaves the app
 * reachable (the person is asked to use the highlighted element). Both props return to normal the moment the tour ends or is
 * cancelled. The overlay itself is rendered OUTSIDE this wrapper.
 */
export function TourBackground({ children }: { readonly children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribeTour, tourHidesBackground, tourHidesBackground);
  return (
    <View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      style={styles.fill}
      testID="tour-background"
    >
      {children}
    </View>
  );
}
