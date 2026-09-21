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
] as const;

export type CollectionColorKey = (typeof COLLECTION_COLOR_KEYS)[number];

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
};

function isCollectionColorKey(color: string): color is CollectionColorKey {
  return (COLLECTION_COLOR_KEYS as readonly string[]).includes(color);
}

/** The pastel {background, icon} pair for an explicit, recognized color key. */
export function resolveCollectionColorTile(color: CollectionColorKey): CollectionColorTile {
  return COLLECTION_COLOR_TILES[color];
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
