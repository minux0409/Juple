import Svg, { Circle, Line } from 'react-native-svg';

interface InfoIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function InfoIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: InfoIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={12} y1={11} x2={12} y2={16.5} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx={12} cy={7.75} r={1.1} fill={color} />
    </Svg>
  );
}
