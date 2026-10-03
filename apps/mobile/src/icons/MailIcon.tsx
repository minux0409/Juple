import Svg, { Path, Rect } from 'react-native-svg';

interface MailIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function MailIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: MailIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={5.5} width={18} height={13} rx={2} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Path d="M3.5 7.5l8.5 6 8.5-6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
