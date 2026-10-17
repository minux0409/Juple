import Svg, { Path } from 'react-native-svg';

interface FlagIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A flag on a pole: "report this" (the Web's `Flag` glyph draws the same shape). */
export function FlagIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: FlagIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 21V4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M5 4h12l-2.5 4L17 12H5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
