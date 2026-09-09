import Svg, { Polygon } from 'react-native-svg';

interface StarIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly filled?: boolean;
}

const STAR_POINTS = '12 3 14.6 8.9 21 9.6 16.2 13.9 17.5 20.2 12 17 6.5 20.2 7.8 13.9 3 9.6 9.4 8.9';

export function StarIcon({
  size = 24,
  color = '#111111',
  strokeWidth = 1.75,
  filled = false,
}: StarIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon
        points={STAR_POINTS}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}
