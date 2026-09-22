import Svg, { Path } from 'react-native-svg';

interface RestoreIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A counter-clockwise "undo/restore" arrow - used for bringing a trashed Item back to active. */
export function RestoreIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: RestoreIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10a8 8 0 1 1 2.34 5.66"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4 4v6h6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
