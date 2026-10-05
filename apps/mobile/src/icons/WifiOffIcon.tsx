import Svg, { Circle, Path } from 'react-native-svg';

interface WifiOffIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** Wi-Fi arcs with a slash through them - "cannot connect", recognizable by its shape alone. */
export function WifiOffIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: WifiOffIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M2.5 9.5a14 14 0 0 1 6-3.4M21.5 9.5a14 14 0 0 0-5-3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M6 13a9 9 0 0 1 3.2-2M18 13a9 9 0 0 0-4-2.3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M9.5 16.5a4 4 0 0 1 5 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx={12} cy={19.5} r={1} fill={color} />
      <Path d="M4 3.5 20 20.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
