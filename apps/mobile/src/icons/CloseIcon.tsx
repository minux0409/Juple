import Svg, { Path } from 'react-native-svg';

interface CloseIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function CloseIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: CloseIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 6l12 12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M18 6L6 18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
