import Svg, { Path } from 'react-native-svg';

interface MoveIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** Two opposite arrows (swap-horizontal) - it reads the same in LTR and RTL, so it is never mirrored. */
export function MoveIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: MoveIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8h15m-4-4 4 4-4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 16H5m4-4-4 4 4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
