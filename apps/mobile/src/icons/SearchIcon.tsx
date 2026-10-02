import Svg, { Circle, Path } from 'react-native-svg';

interface SearchIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function SearchIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: SearchIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M15.5 15.5L20.5 20.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
