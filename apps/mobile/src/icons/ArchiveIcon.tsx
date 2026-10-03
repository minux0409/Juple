import Svg, { Path, Rect } from 'react-native-svg';

interface ArchiveIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A storage box with its lid - the 보관함 (Archive): where saved links are kept, not a history/clock. */
export function ArchiveIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: ArchiveIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4} width={18} height={4.5} rx={1.25} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 12.5h4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
