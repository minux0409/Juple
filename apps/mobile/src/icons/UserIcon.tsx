import Svg, { Circle, Path } from 'react-native-svg';

interface UserIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function UserIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: UserIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={3.5} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M5 20.5a7 7 0 0 1 14 0"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
