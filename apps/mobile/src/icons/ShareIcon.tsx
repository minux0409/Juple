import Svg, { Circle, Line } from 'react-native-svg';

interface ShareIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function ShareIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: ShareIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={18} cy={5.5} r={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={6} cy={12} r={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Circle cx={18} cy={18.5} r={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Line
        x1={8.2}
        y1={10.7}
        x2={15.8}
        y2={6.8}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Line
        x1={8.2}
        y1={13.3}
        x2={15.8}
        y2={17.2}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}
