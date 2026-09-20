import Svg, { Path } from 'react-native-svg';

interface HeartIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function HeartIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: HeartIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20.5s-7.5-4.6-9.8-9.3C.6 7.9 2 4.5 5.3 3.7c2-.5 3.9.3 5 1.9l1.7 2.4 1.7-2.4c1.1-1.6 3-2.4 5-1.9 3.3.8 4.7 4.2 3.1 7.5-2.3 4.7-9.8 9.3-9.8 9.3Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
