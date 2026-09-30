import Svg, { Path, Rect } from 'react-native-svg';

interface UnlockIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** LockIcon with its shackle open - the same body, so the two read as one pair. */
export function UnlockIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: UnlockIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M8 10.5V8a4 4 0 0 1 7.75-1.4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
