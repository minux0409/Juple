import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type CollectionExtraIconName =
  | 'Travel' | 'Fitness' | 'Book' | 'Music' | 'Camera' | 'Movie' | 'Briefcase'
  | 'Car' | 'Gift' | 'Coffee' | 'Calendar' | 'Pet' | 'Sports' | 'Map' | 'Study';

interface CollectionExtraIconProps {
  readonly name: CollectionExtraIconName;
  readonly color?: string;
  readonly size?: number;
}

/** Lightweight built-in category glyphs. They use the app's existing react-native-svg dependency,
 * so expanded persisted icon choices do not require a new icon package. */
export function CollectionExtraIcon({ name, color = '#5478B0', size = 24 }: CollectionExtraIconProps) {
  const common = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const content = (() => {
    switch (name) {
      // A simple paper-airplane silhouette (the universally-recognized "travel/send" glyph) -
      // replaces a prior jagged/star-like path real-device testing found unreadable at small size.
      case 'Travel': return <Path {...common} d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2z" />;
      // Two weighted plates + a bar, drawn with solid Rects (not just thin lines) so it reads
      // unambiguously as a dumbbell even at ~30dp - a prior all-line version was too faint to parse.
      case 'Fitness': return <>
        <Rect {...common} x="2" y="8" width="3" height="8" rx="1" />
        <Rect {...common} x="5.5" y="10" width="2" height="4" rx="0.5" />
        <Path {...common} d="M7.5 12h9" />
        <Rect {...common} x="16.5" y="10" width="2" height="4" rx="0.5" />
        <Rect {...common} x="19" y="8" width="3" height="8" rx="1" />
      </>;
      case 'Book': return <><Path {...common} d="M4 5.5A2.5 2.5 0 016.5 3H20v17H6.5A2.5 2.5 0 014 17.5z" /><Path {...common} d="M4 17.5A2.5 2.5 0 016.5 15H20" /></>;
      case 'Music': return <><Path {...common} d="M9 18V6l10-2v12" /><Circle {...common} cx="6.5" cy="18" r="2.5" /><Circle {...common} cx="16.5" cy="16" r="2.5" /></>;
      case 'Camera': return <><Path {...common} d="M4 8h4l1.5-2h5L16 8h4v11H4z" /><Circle {...common} cx="12" cy="13.5" r="3.5" /></>;
      case 'Movie': return <><Rect {...common} x="3" y="5" width="18" height="14" rx="2" /><Path {...common} d="M3 9h18M7 5l3 4m2-4 3 4m2-4 3 4" /></>;
      case 'Briefcase': return <><Rect {...common} x="3" y="7" width="18" height="12" rx="2" /><Path {...common} d="M9 7V5h6v2m-12 5h18M10 12v2h4v-2" /></>;
      case 'Car': return <><Path {...common} d="M4 15l1.5-5h13l1.5 5v4H4z" /><Path {...common} d="M3 15h18M7 19v2m10-2v2" /><Circle {...common} cx="7" cy="16" r="1" /><Circle {...common} cx="17" cy="16" r="1" /></>;
      case 'Gift': return <><Rect {...common} x="4" y="9" width="16" height="11" rx="1" /><Path {...common} d="M3 9h18v4H3zM12 9v11M12 9C8 8 7 3 10 4c2 1 2 5 2 5zm0 0c4-1 5-6 2-5-2 1-2 5-2 5z" /></>;
      case 'Coffee': return <><Path {...common} d="M5 8h12v9a3 3 0 01-3 3H8a3 3 0 01-3-3zM17 10h1a2 2 0 010 4h-1M7 4v2m4-2v2m4-2v2" /></>;
      case 'Calendar': return <><Rect {...common} x="4" y="5" width="16" height="15" rx="2" /><Path {...common} d="M8 3v4m8-4v4M4 10h16" /></>;
      case 'Pet': return <><Circle {...common} cx="12" cy="14" r="4" /><Circle {...common} cx="6.5" cy="9" r="2" /><Circle {...common} cx="10" cy="5.5" r="2" /><Circle {...common} cx="14" cy="5.5" r="2" /><Circle {...common} cx="17.5" cy="9" r="2" /></>;
      // A plain circle with two simple symmetric seams (baseball-style stitching) - a prior
      // 4-line crossing pattern read as a leaf/abstract shape rather than a ball at small size.
      case 'Sports': return <><Circle {...common} cx="12" cy="12" r="8" /><Path {...common} d="M7 5.5c2 2 2 11 0 13M17 5.5c-2 2-2 11 0 13" /></>;
      case 'Map': return <><Path {...common} d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15" /></>;
      case 'Study': return <><Path {...common} d="M3 9l9-5 9 5-9 5zM7 11v5c3 2 7 2 10 0v-5M21 9v6" /></>;
    }
  })();
  return <Svg height={size} viewBox="0 0 24 24" width={size}>{content}</Svg>;
}
