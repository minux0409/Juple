import Svg, { Path, Rect } from 'react-native-svg';

interface LockIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function LockIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: LockIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
