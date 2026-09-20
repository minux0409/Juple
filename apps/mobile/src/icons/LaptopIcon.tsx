import Svg, { Path } from 'react-native-svg';

interface LaptopIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function LaptopIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: LaptopIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 5.5A1 1 0 0 1 6 4.5h12a1 1 0 0 1 1 1V16H5Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.5 16h19l-1.4 2.8a1.5 1.5 0 0 1-1.4.9H5.3a1.5 1.5 0 0 1-1.4-.9z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
