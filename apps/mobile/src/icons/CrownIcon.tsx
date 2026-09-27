import Svg, { Path } from 'react-native-svg';

interface CrownIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** The Owner marker in participant lists - a vector glyph, so it looks the same on every platform. */
export function CrownIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: CrownIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 8l3.75 4.5L12 5.5l4.25 7L20 8l-1.5 9h-13z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      <Path d="M6 20.5h12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
