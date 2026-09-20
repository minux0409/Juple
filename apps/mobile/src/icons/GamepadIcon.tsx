import Svg, { Circle, Line, Path } from 'react-native-svg';

interface GamepadIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function GamepadIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: GamepadIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6.5 8h11a3.5 3.5 0 0 1 3.4 4.3l-.8 3.4a2.2 2.2 0 0 1-3.9.8L15 15H9l-1.2 1.5a2.2 2.2 0 0 1-3.9-.8l-.8-3.4A3.5 3.5 0 0 1 6.5 8Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1="6.5" y1="12" x2="9" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1="7.75" y1="10.75" x2="7.75" y2="13.25" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="15.5" cy="11" r="0.9" fill={color} />
      <Circle cx="17.5" cy="13" r="0.9" fill={color} />
    </Svg>
  );
}
