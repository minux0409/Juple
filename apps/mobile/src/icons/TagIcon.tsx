import Svg, { Circle, Path } from 'react-native-svg';

interface TagIconProps {
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}

export function TagIcon({ size = 24, color = '#111111', strokeWidth = 1.75 }: TagIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.6 3.5h6.9a1 1 0 0 1 1 1v6.9a1 1 0 0 1-.3.7l-9 9a1 1 0 0 1-1.4 0l-7.2-7.2a1 1 0 0 1 0-1.4l9-9a1 1 0 0 1 .7-.3Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="16.5" cy="7.5" r="1.4" stroke={color} strokeWidth={strokeWidth} />
    </Svg>
  );
}
