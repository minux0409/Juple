import Svg, { Path } from 'react-native-svg';

interface FolderIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
  /** The solid version (a selected tab): the same outline, filled - same size and position. */
  readonly filled?: boolean;
}

export function FolderIcon({ size = 24, color = '#111111', strokeWidth = 1.75, filled = false }: FolderIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
