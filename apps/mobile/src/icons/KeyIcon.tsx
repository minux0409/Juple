import Svg, { Circle, Path } from 'react-native-svg';

interface KeyIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A key - the share password (distinct from LockIcon, the Owner's Collection lock). */
export function KeyIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: KeyIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={8} cy={15} r={4} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M10.8 12.2 19 4m-3 3 2.5 2.5M13.5 9.5l2 2" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
