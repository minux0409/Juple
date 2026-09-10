import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radii } from '../theme/tokens';

interface ProgressBarProps {
  /** 0..1 - the real, currently-known fraction of work done. Never advanced by a timer. */
  readonly progress: number;
}

/**
 * Determinate progress bar. The fill only ever eases toward a new caller-supplied fraction (a
 * short cosmetic transition between two real values) - it never advances on its own.
 */
export function ProgressBar({ progress }: ProgressBarProps) {
  const widthAnim = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  return (
    <View accessibilityRole="progressbar" style={styles.track}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: widthAnim.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.sm,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.sm,
    height: '100%',
  },
});
