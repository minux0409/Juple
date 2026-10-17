import Svg, { Circle, Path } from 'react-native-svg';

interface BlockIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A circle with a slash: "block this person" (the Web's `Block` glyph draws the same shape). */
export function BlockIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: BlockIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M5.6 5.6l12.8 12.8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
