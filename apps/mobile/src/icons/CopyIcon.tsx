import Svg, { Path, Rect } from 'react-native-svg';

interface CopyIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function CopyIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: CopyIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={9} y={9} width={11} height={11} rx={2} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M15 5.5V5a1 1 0 0 0-1-1H6a2 2 0 0 0-2 2v8a1 1 0 0 0 1 1h.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
