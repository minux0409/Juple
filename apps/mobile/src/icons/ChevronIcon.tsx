import Svg, { Polyline } from 'react-native-svg';

interface ChevronIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly direction?: 'up' | 'down' | 'left' | 'right';
}

const ROTATION_BY_DIRECTION: Record<NonNullable<ChevronIconProps['direction']>, number> = {
  down: 0,
  up: 180,
  left: 90,
  right: -90,
};

/** Single chevron-down path rotated per `direction`, avoiding four separate point sets. */
export function ChevronIcon({
  size = 24,
  color = '#111111',
  strokeWidth = 1.75,
  direction = 'down',
}: ChevronIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: [{ rotate: `${ROTATION_BY_DIRECTION[direction]}deg` }] }}
    >
      <Polyline
        points="6 9 12 15 18 9"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
