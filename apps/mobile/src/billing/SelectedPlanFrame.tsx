import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useReduceMotion } from '../components/useReduceMotion';
import { MEMBERSHIP_GRADIENT } from './MembershipPromptDialog';

const STROKE = 2;
let counter = 0;

/**
 * The selected plan card's border: Juple's pink -> violet -> blue gradient, drawn over the card's own edge at its measured size (never a
 * percentage-sized Svg) and never taking touches. It fades in when a card becomes selected; with Reduce Motion it is simply there.
 */
export function SelectedPlanFrame({ selected, radius }: { readonly selected: boolean; readonly radius: number }) {
  const id = useRef(`selectedPlanFrame${counter++}`).current;
  const reduceMotion = useReduceMotion();
  const [size, setSize] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const opacity = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(selected ? 1 : 0);
      return;
    }
    Animated.timing(opacity, { toValue: selected ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [opacity, reduceMotion, selected]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
  };

  return (
    <Animated.View onLayout={onLayout} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]} testID={selected ? 'selected-plan-frame' : undefined}>
      {size ? (
        <Svg height={size.height} width={size.width}>
          <Defs>
            <LinearGradient id={id} x1="0" x2="1" y1="0" y2="1">
              <Stop offset="0" stopColor={MEMBERSHIP_GRADIENT[0]} />
              <Stop offset="0.55" stopColor={MEMBERSHIP_GRADIENT[1]} />
              <Stop offset="1" stopColor={MEMBERSHIP_GRADIENT[2]} />
            </LinearGradient>
          </Defs>
          <Rect
            fill="none"
            height={size.height - STROKE}
            rx={radius - STROKE / 2}
            stroke={`url(#${id})`}
            strokeWidth={STROKE}
            width={size.width - STROKE}
            x={STROKE / 2}
            y={STROKE / 2}
          />
        </Svg>
      ) : null}
    </Animated.View>
  );
}
