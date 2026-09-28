import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface ImageIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A photo glyph (frame, sun, hill) - e.g. "use my own photo" as a Collection's icon. */
export function ImageIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: ImageIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={4.5} width={17} height={15} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={9} cy={9.5} r={1.75} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="m4 17.5 4.8-4.6a1.5 1.5 0 0 1 2.05-.02L14 15.7l2.2-2a1.5 1.5 0 0 1 2.03.01l2.27 2.1"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
