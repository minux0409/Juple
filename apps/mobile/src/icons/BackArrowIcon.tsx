import { I18nManager } from 'react-native';
import Svg, { Path } from 'react-native-svg';

interface BackArrowIconProps {
  readonly size?: number;
  readonly color?: string;
}

/**
 * The navigation "back" arrow - the same Material arrow the Android header shows - drawn here so an iOS header can show
 * exactly that glyph instead of the system chevron. Mirrored in a right-to-left layout, as Android's is.
 */
export function BackArrowIcon({ size = 24, color = '#111111' }: BackArrowIconProps) {
  return (
    <Svg height={size} style={I18nManager.isRTL ? mirrored : undefined} viewBox="0 0 24 24" width={size}>
      <Path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill={color} />
    </Svg>
  );
}

const mirrored = { transform: [{ scaleX: -1 }] };
