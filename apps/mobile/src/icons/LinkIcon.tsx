import Svg, { Path } from 'react-native-svg';
import type { StyleProp, ViewStyle } from 'react-native';

interface LinkIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  readonly style?: StyleProp<ViewStyle>;
}

export function LinkIcon({
  size = 24,
  color = '#111111',
  strokeWidth = 1.75,
  style,
}: LinkIconProps) {
  return (
    <Svg height={size} style={style} viewBox="0 0 24 24" width={size} fill="none">
      <Path
        d="M9.5 14.5 14.5 9.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M11 6.5 12.4 5.1a3.5 3.5 0 0 1 4.95 4.95L15.9 11.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M13 17.5 11.6 18.9a3.5 3.5 0 0 1-4.95-4.95L8.1 12.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
