import { useMemo, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { JUPLE_GRADIENT } from './FavoriteStar';

interface GradientPillProps {
  readonly label: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

let counter = 0;

/** A small badge filled with the Juple wordmark gradient (coral -> pink -> violet), drawn with SVG so it needs no extra library. */
export function GradientPill({ label, style, testID }: GradientPillProps) {
  const id = useRef(`gradientPill${counter++}`).current;
  const stops = useMemo(() => JUPLE_GRADIENT, []);
  return (
    <View style={[styles.pill, style]} testID={testID}>
      <Svg height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill} width="100%">
        <Defs>
          <LinearGradient id={id} x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor={stops[0]} />
            <Stop offset="0.5" stopColor={stops[1]} />
            <Stop offset="1" stopColor={stops[2]} />
          </LinearGradient>
        </Defs>
        <Rect fill={`url(#${id})`} height="100%" width="100%" />
      </Svg>
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: 999, flexShrink: 1, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4 },
  label: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
