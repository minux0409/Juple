import Svg, { Line, Rect } from 'react-native-svg';

interface CreditCardIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A payment card (outline, stripe, short line) - the 구독 / billing glyph. */
export function CreditCardIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: CreditCardIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={5.5} width={18} height={13} rx={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={3} y1={10} x2={21} y2={10} stroke={color} strokeWidth={strokeWidth} />
      <Line x1={7} y1={14.5} x2={11} y2={14.5} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
