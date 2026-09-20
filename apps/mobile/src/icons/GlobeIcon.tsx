import Svg, { Ellipse, Circle, Line } from 'react-native-svg';

interface GlobeIconProps {
  readonly size?: number;
  readonly color?: string;
}

/** Generic "unrecognized site" badge - a plain globe glyph, used whenever a URL's host isn't one of the few specifically-detected sites (see resolveSiteInfo.ts). Theme-driven (unlike the brand icons), so it fades appropriately into the surrounding UI. */
export function GlobeIcon({ size = 24, color = '#9AA5B1' }: GlobeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
      <Ellipse cx="12" cy="12" rx="3.6" ry="9" stroke={color} strokeWidth="1.6" />
      <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth="1.6" />
    </Svg>
  );
}
