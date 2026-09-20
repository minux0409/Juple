import Svg, { Circle, Path } from 'react-native-svg';

interface NaverIconProps {
  readonly size?: number;
}

/** Fixed brand color (not theme-driven) - recognizability matters more here than palette consistency, matching how every app shows this logo. A simplified "N" glyph, not a pixel-exact reproduction of Naver's logomark. A small circular badge, matching this round's site-icon visual language. */
export function NaverIcon({ size = 24 }: NaverIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="11" fill="#03C75A" />
      <Path
        d="M8.6 7.2h2l3 4.6V7.2h2v9.6h-2l-3-4.6v4.6h-2V7.2Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}
