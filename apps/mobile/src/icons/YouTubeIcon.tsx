import Svg, { Path, Rect } from 'react-native-svg';

interface YouTubeIconProps {
  readonly size?: number;
}

/** Fixed brand colors (not theme-driven) - recognizability matters more here than palette consistency, matching how every app shows this logo. */
export function YouTubeIcon({ size = 24 }: YouTubeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="1" y="4.5" width="22" height="15" rx="4" fill="#FF0000" />
      <Path d="M10 8.5 16 12l-6 3.5v-7Z" fill="#FFFFFF" />
    </Svg>
  );
}
