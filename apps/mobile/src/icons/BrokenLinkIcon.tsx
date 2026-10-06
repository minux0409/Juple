import Svg, { Path } from 'react-native-svg';

interface BrokenLinkIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/**
 * A chain link broken in the middle - "the connection is lost" - for every network/offline load failure. The two halves
 * are LinkIcon's own (same stroke family), pulled apart, with short break marks where they used to join.
 */
export function BrokenLinkIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: BrokenLinkIconProps) {
  return (
    <Svg fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <Path
        d="M12.6 5.4 13.4 4.6a3.5 3.5 0 0 1 4.95 4.95L17.6 10.3"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <Path
        d="M11.4 18.6 10.6 19.4a3.5 3.5 0 0 1-4.95-4.95L6.4 13.7"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <Path d="M9 4.5v2.2M4.5 9h2.2M15 19.5v-2.2M19.5 15h-2.2" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />
    </Svg>
  );
}
