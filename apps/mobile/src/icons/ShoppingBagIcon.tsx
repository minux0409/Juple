import Svg, { Path } from 'react-native-svg';

interface ShoppingBagIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function ShoppingBagIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: ShoppingBagIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 8h13l1 12a1.5 1.5 0 0 1-1.5 1.6H6a1.5 1.5 0 0 1-1.5-1.6z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M8 8V6.5a4 4 0 0 1 8 0V8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
