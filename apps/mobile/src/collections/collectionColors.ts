/**
 * The fixed set of preset pastel colors a user may explicitly assign to a Collection - must exactly
 * match the backend's CollectionColor enum member names (see
 * backend/src/Juple.Domain/Collections/CollectionColor.cs), since a Collection's `color` field (see
 * collectionsApi.ts) is that enum's string name verbatim, or null when no explicit color was ever
 * chosen. Order here is display order in the swatch row only.
 *
 * Deliberately NOT an arbitrary/HEX color picker (see CollectionColor's own remarks) - every value
 * below is a pastel {background, icon} pair in the same soft, low-saturation style as the existing
 * deterministic categoryTilePalette (theme/tokens.ts), several reusing its exact values, so a
 * user-chosen color never looks more saturated/out of place than the app's existing fallback tiles.
 */
export const COLLECTION_COLOR_KEYS = [
  'Blue',
  'Mint',
  'Rose',
  'Amber',
  'Purple',
  'Peach',
  'Teal',
  'Slate',
  'Coral',
  'Lime',
  'Sky',
  'Indigo',
  'Lavender',
  'Sand',
] as const;

export type CollectionColorKey = (typeof COLLECTION_COLOR_KEYS)[number];
/** Either a persisted preset name or a validated custom #RRGGBB hue chosen in the editor. */
export type CollectionColorValue = CollectionColorKey | `#${string}`;

/** What a brand-new Collection's create form starts with already selected - mirrors the backend's own default. */
export const DEFAULT_COLLECTION_COLOR: CollectionColorKey = 'Blue';

interface CollectionColorTile {
  readonly background: string;
  readonly icon: string;
}

const COLLECTION_COLOR_TILES: Readonly<Record<CollectionColorKey, CollectionColorTile>> = {
  Blue: { background: '#EAF1FE', icon: '#5478B0' },
  Mint: { background: '#EAF5EE', icon: '#5C9878' },
  Rose: { background: '#FBEDEE', icon: '#B97278' },
  Amber: { background: '#FBF3DE', icon: '#B0924E' },
  Purple: { background: '#F1EBF7', icon: '#8A72A8' },
  Peach: { background: '#FBEEE6', icon: '#BD8863' },
  Teal: { background: '#E6F5F3', icon: '#4E9690' },
  Slate: { background: '#EDF1F5', icon: '#6B7A8F' },
  Coral: { background: '#FDEDEA', icon: '#C86B5D' },
  Lime: { background: '#F0F7E7', icon: '#729B45' },
  Sky: { background: '#EAF6FC', icon: '#4D92B7' },
  Indigo: { background: '#ECEEFA', icon: '#6574B7' },
  Lavender: { background: '#F5EFFA', icon: '#9473B1' },
  Sand: { background: '#F7F1E7', icon: '#A48257' },
};

function isCollectionColorKey(color: string): color is CollectionColorKey {
  return (COLLECTION_COLOR_KEYS as readonly string[]).includes(color);
}

/**
 * Resolves a Collection's `color` wire value (a plain nullable string - see Collection.color) to a
 * color key, or null when there is none (a legacy/unset row) or the value isn't one this build
 * recognizes - callers must treat null as "use the existing id-deterministic palette fallback"
 * (see CategoryIconTile), never as "use DEFAULT_COLLECTION_COLOR".
 */
export function resolveCollectionColorKey(color: string | null): CollectionColorKey | null {
  return color !== null && isCollectionColorKey(color) ? color : null;
}

export function isCustomCollectionColor(color: string | null): color is `#${string}` {
  return color !== null && /^#[0-9A-F]{6}$/i.test(color);
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function componentToHex(component: number): string {
  return Math.round(component).toString(16).padStart(2, '0').toUpperCase();
}

/** Converts a hue selection into Juple's deliberately soft tile palette, not a neon raw hue. */
export function customColorFromHue(hue: number): `#${string}` {
  const normalized = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * 0.72 - 1)) * 0.42;
  const x = chroma * (1 - Math.abs((normalized / 60) % 2 - 1));
  const m = 0.72 - chroma / 2;
  const [r, g, b] = normalized < 60 ? [chroma, x, 0] : normalized < 120 ? [x, chroma, 0] : normalized < 180 ? [0, chroma, x] : normalized < 240 ? [0, x, chroma] : normalized < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${componentToHex((r + m) * 255)}${componentToHex((g + m) * 255)}${componentToHex((b + m) * 255)}` as `#${string}`;
}

export function hueFromCustomColor(hex: string): number {
  const [rawR, rawG, rawB] = hexToRgb(hex);
  const r = rawR / 255; const g = rawG / 255; const b = rawB / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  if (delta === 0) return 0;
  const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

export function resolveCollectionColorTile(color: CollectionColorValue): CollectionColorTile {
  if (isCollectionColorKey(color)) return COLLECTION_COLOR_TILES[color];
  const [r, g, b] = hexToRgb(color);
  const darken = (value: number) => Math.max(0, value - 72);
  return { background: color, icon: `#${componentToHex(darken(r))}${componentToHex(darken(g))}${componentToHex(darken(b))}` };
}

/**
 * The named color key matching categoryTilePalette's own id-deterministic fallback pair at the same
 * index (theme/tokens.ts) - each entry below intentionally shares its exact background/icon hex
 * with that palette slot, so this is an exact (not approximate) match, never a guess. Lets a color
 * draft (see CategoryNameAndIconField) start pre-selected on whichever named color already visually
 * matches a Collection's current effective (fallback) appearance, for a Collection that has no
 * explicit color yet - see CollectionDetailsScreen's startEditName.
 */
const DETERMINISTIC_PALETTE_COLOR_KEYS: readonly CollectionColorKey[] = [
  'Blue',
  'Rose',
  'Amber',
  'Mint',
  'Purple',
  'Peach',
];

/** Resolves a Collection's currently effective color key: its explicit color if set, otherwise the named color key matching its id-deterministic fallback tile. Always returns a concrete key - never null, unlike resolveCollectionColorKey. */
export function resolveEffectiveCollectionColorKey(color: string | null, collectionId: number): CollectionColorKey {
  const explicit = resolveCollectionColorKey(color);
  if (explicit) {
    return explicit;
  }
  return DETERMINISTIC_PALETTE_COLOR_KEYS[Math.abs(collectionId) % DETERMINISTIC_PALETTE_COLOR_KEYS.length];
}

export function resolveEffectiveCollectionColorValue(color: string | null, collectionId: number): CollectionColorValue {
  return isCustomCollectionColor(color) ? color.toUpperCase() as `#${string}` : resolveEffectiveCollectionColorKey(color, collectionId);
}
