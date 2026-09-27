import Svg, { Circle, Path } from 'react-native-svg';

interface PeopleIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** Two people - the "shared with others" (공동작업) marker, distinct from the public-link ShareIcon. */
export function PeopleIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: PeopleIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={8.5} r={3.25} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <Circle cx={16.5} cy={9.5} r={2.5} stroke={color} strokeWidth={strokeWidth} />
      <Path d="M16.5 14c2.6 0 4.5 1.8 4.5 4.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
