import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { JUPLE_GRADIENT } from './FavoriteStar';

interface GradientPillProps {
  readonly label: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

let counter = 0;

/**
 * A small badge filled with the Juple wordmark gradient (coral -> pink -> violet), drawn with SVG so it needs no extra library.
 * The gradient is drawn at the pill's MEASURED size: a percentage-sized Svg drew a smaller rectangle on iOS, leaving the white label
 * partly outside the gradient (invisible on a light card). Until the size is known the pill shows its solid brand fallback.
 */
export function GradientPill({ label, style, testID }: GradientPillProps) {
  const id = useRef(`gradientPill${counter++}`).current;
  const stops = useMemo(() => JUPLE_GRADIENT, []);
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
  };
  return (
    <View onLayout={onLayout} style={[styles.pill, style]} testID={testID}>
      {size ? (
        <Svg height={size.height} style={StyleSheet.absoluteFill} width={size.width}>
          <Defs>
            <LinearGradient id={id} x1="0" x2="1" y1="0" y2="0">
              <Stop offset="0" stopColor={stops[0]} />
              <Stop offset="0.5" stopColor={stops[1]} />
              <Stop offset="1" stopColor={stops[2]} />
            </LinearGradient>
          </Defs>
          <Rect fill={`url(#${id})`} height={size.height} rx={size.height / 2} ry={size.height / 2} width={size.width} />
        </Svg>
      ) : null}
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // The solid middle stop of the gradient: the label stays readable before the first layout and if the SVG cannot draw.
  pill: { alignSelf: 'flex-start', backgroundColor: JUPLE_GRADIENT[1], borderRadius: 999, flexShrink: 0, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 4 },
  label: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
