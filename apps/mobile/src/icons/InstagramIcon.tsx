import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface InstagramIconProps {
  readonly size?: number;
}

/** Fixed brand gradient (not theme-driven) - recognizability matters more here than palette consistency, matching how every app shows this logo. A small circular badge, matching this round's site-icon visual language. */
export function InstagramIcon({ size = 24 }: InstagramIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id="instagramGradient" x1="0" y1="24" x2="24" y2="0">
          <Stop offset="0" stopColor="#FFDD55" />
          <Stop offset="0.5" stopColor="#E1306C" />
          <Stop offset="1" stopColor="#5851DB" />
        </LinearGradient>
      </Defs>
      <Circle cx="12" cy="12" r="11" fill="url(#instagramGradient)" />
      <Circle cx="12" cy="12" r="4.2" stroke="#FFFFFF" strokeWidth="1.6" />
      <Circle cx="16.3" cy="7.7" r="1" fill="#FFFFFF" />
    </Svg>
  );
}
