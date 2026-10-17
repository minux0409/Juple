import Svg, { Circle, Path } from 'react-native-svg';

interface ContrastIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A circle with one half filled: "appearance" (light / dark). */
export function ContrastIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: ContrastIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill={color} />
    </Svg>
  );
}
