import Svg, { Line, Path } from 'react-native-svg';

interface EmptyTrashIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/**
 * "Empty / clear everything": a bin with sweep lines trailing off its side (the "delete sweep" shape), so it never
 * reads as TrashIcon's single-item delete. Same 24px line style as the rest of the icon set.
 */
export function EmptyTrashIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: EmptyTrashIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={10.5} y1={7} x2={21.5} y2={7} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Path d="M14 7V5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 7l.7 11.5a2 2 0 0 0 2 1.9h2.6a2 2 0 0 0 2-1.9L20 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1={2.5} y1={10} x2={8} y2={10} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={2.5} y1={14} x2={9} y2={14} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Line x1={2.5} y1={18} x2={8} y2={18} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
