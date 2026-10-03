import Svg, { Circle, Line, Path } from 'react-native-svg';

interface UserMinusIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A person with a minus: "remove this person" (UserIcon's outline, shifted to make room). */
export function UserMinusIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: UserMinusIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9.5} cy={8} r={3.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3 20.5a6.5 6.5 0 0 1 13 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={16.5} y1={11} x2={21.5} y2={11} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
