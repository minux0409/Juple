import Svg, { Polyline } from 'react-native-svg';

interface ArrowHeadIconProps {
  readonly direction: 'left' | 'right';
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/**
 * A plain "<" or ">" drawn with explicit points - no rotation involved, so what it shows is exactly what its
 * direction says on every platform (the calendar's month arrows rely on that).
 */
export function ArrowHeadIcon({ direction, size = 24, color = '#111111', strokeWidth = 1.75 }: ArrowHeadIconProps) {
  const points = direction === 'left' ? '15 6 9 12 15 18' : '9 6 15 12 9 18';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline points={points} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
