import Svg, { Circle, Path } from 'react-native-svg';

interface HelpIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** A circled question mark - same circle, stroke and dot as InfoIcon, so the two read as a pair. */
export function HelpIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: HelpIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M9.5 9.6a2.5 2.5 0 1 1 3.6 2.25c-.75.4-1.1.9-1.1 1.7"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={16.6} r={1.1} fill={color} />
    </Svg>
  );
}
