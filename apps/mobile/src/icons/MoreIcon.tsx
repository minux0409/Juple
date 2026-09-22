import Svg, { Circle } from 'react-native-svg';

export function MoreIcon({ size = 24, color = '#111111' }: { readonly size?: number; readonly color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Circle cx="5" cy="12" fill={color} r="1.7" /><Circle cx="12" cy="12" fill={color} r="1.7" /><Circle cx="19" cy="12" fill={color} r="1.7" /></Svg>;
}
