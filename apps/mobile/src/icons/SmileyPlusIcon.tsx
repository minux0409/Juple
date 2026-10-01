import Svg, { Circle, Path } from 'react-native-svg';

interface SmileyPlusIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A smiley with a small plus: "add a reaction". */
export function SmileyPlusIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: SmileyPlusIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20.5 11.2A8.5 8.5 0 1 1 12.8 3.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path d="M8.6 14a4 4 0 0 0 6.2 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx="9" cy="10" r="1" fill={color} />
      <Circle cx="14.5" cy="10" r="1" fill={color} />
      <Path d="M19 2.5v5M16.5 5h5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
