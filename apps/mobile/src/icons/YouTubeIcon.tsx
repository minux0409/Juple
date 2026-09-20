import Svg, { Circle, Path } from 'react-native-svg';

interface YouTubeIconProps {
  readonly size?: number;
}

/** Fixed brand color (not theme-driven) - recognizability matters more here than palette consistency, matching how every app shows this logo. A small circular badge, matching this round's site-icon visual language. */
export function YouTubeIcon({ size = 24 }: YouTubeIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="11" fill="#FF0000" />
      <Path d="M9.8 8.3 16 12l-6.2 3.7v-7.4Z" fill="#FFFFFF" />
    </Svg>
  );
}
