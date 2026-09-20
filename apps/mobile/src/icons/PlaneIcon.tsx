import Svg, { Path } from 'react-native-svg';

interface PlaneIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function PlaneIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: PlaneIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 3 3 10.5l6.5 2.2 2.2 6.5L21 3Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M11.7 12.3 21 3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
