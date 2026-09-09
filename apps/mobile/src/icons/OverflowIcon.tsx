import Svg, { Circle } from 'react-native-svg';

interface OverflowIconProps {
  readonly size?: number;
  readonly color?: string;
}

/** Vertical kebab (⋮) - overflow/more-actions trigger. */
export function OverflowIcon({ size = 24, color = '#111111' }: OverflowIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5} r={1.3} fill={color} />
      <Circle cx={12} cy={12} r={1.3} fill={color} />
      <Circle cx={12} cy={19} r={1.3} fill={color} />
    </Svg>
  );
}
