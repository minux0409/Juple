import Svg, { Path } from 'react-native-svg';

interface HomeIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function HomeIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: HomeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-4.5a1 1 0 0 1-1-1v-5h-5v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
