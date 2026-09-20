import Svg, { Path } from 'react-native-svg';

interface UtensilsIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** Fork + knife - used for the "cooking" category icon (see collectionIcons.ts). */
export function UtensilsIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: UtensilsIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 3v6a2 2 0 0 1-2 2 2 2 0 0 1-2-2V3M7 11v10"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M17 3c-1.7 0-3 2-3 5s1.3 5 3 5v8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
