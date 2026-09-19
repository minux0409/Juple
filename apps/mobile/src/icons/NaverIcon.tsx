import Svg, { Path, Rect } from 'react-native-svg';

interface NaverIconProps {
  readonly size?: number;
}

/** Fixed brand color (not theme-driven) - recognizability matters more here than palette consistency, matching how every app shows this logo. A simplified "N" glyph, not a pixel-exact reproduction of Naver's logomark. */
export function NaverIcon({ size = 24 }: NaverIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="1" y="1" width="22" height="22" rx="6" fill="#03C75A" />
      <Rect x="6.6" y="6" width="2.6" height="12" fill="#FFFFFF" />
      <Rect x="14.8" y="6" width="2.6" height="12" fill="#FFFFFF" />
      <Path d="M9.2 7 15.2 17" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="butt" />
    </Svg>
  );
}
