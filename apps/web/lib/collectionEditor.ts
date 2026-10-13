import { ApiHttpError, type AppApi } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { collectionIconKey, type CollectionSummary } from './collectionsView.ts';

/**
 * Creating and editing a Collection - the mobile CategoryEditorDialog and its two callers (CollectionsScreen.handleCreateSubmit,
 * CollectionDetailsScreen.submitEdit) on the same endpoints: the name (1..100 after trimming), one of the fixed icons, one of the 14
 * preset colors or a custom soft hue (#RRGGBB), and optionally the Owner's own photo as the icon. Only the Owner edits.
 */

/** The preset colors in the picker's order (apps/mobile/src/collections/collectionColors.ts COLLECTION_COLOR_KEYS). */
export const COLLECTION_COLOR_KEYS = ['Blue', 'Mint', 'Rose', 'Amber', 'Purple', 'Peach', 'Teal', 'Slate', 'Coral', 'Lime', 'Sky', 'Indigo', 'Lavender', 'Sand'] as const;
export type CollectionColorKey = (typeof COLLECTION_COLOR_KEYS)[number];
/** A preset name, or a custom #RRGGBB hue chosen in the editor. */
export type CollectionColorValue = CollectionColorKey | `#${string}`;
export const DEFAULT_COLLECTION_COLOR: CollectionColorKey = 'Blue';

/** The id-deterministic palette a Collection with no color shows (mobile resolveEffectiveCollectionColorKey: categoryTilePalette's keys). */
const FALLBACK_COLOR_KEYS: readonly CollectionColorKey[] = ['Blue', 'Rose', 'Amber', 'Mint', 'Purple', 'Peach'];

export function isCollectionColorKey(color: string | null | undefined): color is CollectionColorKey {
  return (COLLECTION_COLOR_KEYS as readonly string[]).includes(color ?? '');
}

export function isCustomCollectionColor(color: string | null | undefined): color is `#${string}` {
  return typeof color === 'string' && /^#[0-9A-F]{6}$/i.test(color);
}

/** What the editor starts with for an existing Collection: its own color, else the palette color it is shown in (mobile). */
export function effectiveCollectionColor(color: string | null, collectionId: number): CollectionColorValue {
  if (isCustomCollectionColor(color)) {
    return color.toUpperCase() as `#${string}`;
  }
  return isCollectionColorKey(color) ? color : FALLBACK_COLOR_KEYS[Math.abs(collectionId) % FALLBACK_COLOR_KEYS.length];
}

function componentToHex(component: number): string {
  return Math.round(component).toString(16).padStart(2, '0').toUpperCase();
}

/** A hue on the rail -> Juple's deliberately soft tile color, never a neon raw hue (mobile customColorFromHue, same math). */
export function customColorFromHue(hue: number): `#${string}` {
  const normalized = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * 0.72 - 1)) * 0.42;
  const x = chroma * (1 - Math.abs(((normalized / 60) % 2) - 1));
  const m = 0.72 - chroma / 2;
  const [r, g, b] =
    normalized < 60 ? [chroma, x, 0] : normalized < 120 ? [x, chroma, 0] : normalized < 180 ? [0, chroma, x] : normalized < 240 ? [0, x, chroma] : normalized < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return `#${componentToHex((r + m) * 255)}${componentToHex((g + m) * 255)}${componentToHex((b + m) * 255)}` as `#${string}`;
}

export function hueFromCustomColor(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  const hue = max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return hue < 0 ? hue + 360 : hue;
}

/** The mobile name rule: required, at most 100 characters after trimming (the server validates again). */
export function collectionNameError(name: string, dictionary: AppDictionary): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return dictionary.errorNameRequired;
  }
  if (trimmed.length > 100) {
    return dictionary.errorNameTooLong;
  }
  return null;
}

/** The editor's photo choice: keep what is there, a newly picked file, or remove the photo (back to the icon). */
export type IconImageChange = { readonly kind: 'keep' } | { readonly kind: 'set'; readonly file: File } | { readonly kind: 'remove' };

export interface CollectionDraft {
  readonly name: string;
  readonly icon: string;
  readonly color: CollectionColorValue;
  readonly image: IconImageChange;
}

/** Mobile getCreateErrorMessage / getRenameErrorMessage: 409 = the name is taken, 400 = the name was refused. */
export function nameSaveError(error: unknown, dictionary: AppDictionary, fallback: string): string {
  if (error instanceof ApiHttpError) {
    if (error.status === 409) {
      return dictionary.errorNameConflict;
    }
    if (error.status === 400) {
      return dictionary.errorNameInvalid;
    }
  }
  return fallback;
}

function iconImageError(error: unknown, dictionary: AppDictionary): string {
  return error instanceof ApiHttpError && error.status === 400 ? dictionary.iconPhotoInvalid : dictionary.iconPhotoSaveFallback;
}

export type SaveOutcome = { readonly ok: true; readonly collection: CollectionSummary; readonly warning: string | null } | { readonly ok: false; readonly error: unknown; readonly message: string };

async function applyImage(api: AppApi, collection: CollectionSummary, change: IconImageChange, headers?: Readonly<Record<string, string>>): Promise<CollectionSummary> {
  if (change.kind === 'set') {
    const form = new FormData();
    form.append('file', change.file, change.file.name || 'icon');
    return api<CollectionSummary>({ method: 'PUT', path: `/api/v1/collections/${collection.id}/icon-image`, body: form, headers });
  }
  if (change.kind === 'remove' && collection.iconImageUrl) {
    return api<CollectionSummary>({ method: 'DELETE', path: `/api/v1/collections/${collection.id}/icon-image`, headers });
  }
  return collection;
}

/**
 * Create (mobile handleCreateSubmit): POST the name / icon / color; the photo goes up only once the Collection exists - if that part
 * fails the Collection is still created (with its built-in icon) and the reason is said.
 */
export async function createCollection(api: AppApi, draft: CollectionDraft, dictionary: AppDictionary): Promise<SaveOutcome> {
  let created: CollectionSummary;
  try {
    created = await api<CollectionSummary>({ method: 'POST', path: '/api/v1/collections', body: { name: draft.name.trim(), icon: draft.icon, color: draft.color } });
  } catch (error) {
    return { ok: false, error, message: nameSaveError(error, dictionary, dictionary.errorCreate) };
  }
  if (draft.image.kind !== 'set') {
    return { ok: true, collection: created, warning: null };
  }
  try {
    return { ok: true, collection: await applyImage(api, created, draft.image), warning: null };
  } catch (error) {
    return { ok: true, collection: created, warning: iconImageError(error, dictionary) };
  }
}

/**
 * Edit (mobile submitEdit): only what changed, in order - name, icon, color, photo - stopping at the first failure. A locked
 * Collection's edits carry its unlock grant (`headers`), as on mobile.
 */
export async function updateCollection(
  api: AppApi,
  collection: CollectionSummary,
  draft: CollectionDraft,
  dictionary: AppDictionary,
  headers?: Readonly<Record<string, string>>,
): Promise<SaveOutcome> {
  let current = collection;
  const name = draft.name.trim();
  try {
    if (name !== collection.name) {
      await api<void>({ method: 'PUT', path: `/api/v1/collections/${collection.id}`, body: { name }, headers });
      current = { ...current, name };
    }
  } catch (error) {
    return { ok: false, error, message: nameSaveError(error, dictionary, dictionary.errorRename) };
  }
  try {
    if (draft.icon !== collectionIconKey(collection.icon)) {
      current = await api<CollectionSummary>({ method: 'PUT', path: `/api/v1/collections/${collection.id}/icon`, body: { icon: draft.icon }, headers });
    }
  } catch (error) {
    return { ok: false, error, message: dictionary.errorIconUpdate };
  }
  try {
    if (draft.color !== effectiveCollectionColor(collection.color, collection.id)) {
      current = await api<CollectionSummary>({ method: 'PUT', path: `/api/v1/collections/${collection.id}/color`, body: { color: draft.color }, headers });
    }
  } catch (error) {
    return { ok: false, error, message: dictionary.errorColorUpdate };
  }
  try {
    current = await applyImage(api, current, draft.image, headers);
  } catch (error) {
    return { ok: false, error, message: iconImageError(error, dictionary) };
  }
  return { ok: true, collection: current, warning: null };
}

/** Only the Owner edits a Collection (mobile: the edit entry is in the Owner's menu). */
export function canEditCollection(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return collection.accessRole === undefined || collection.accessRole === 'owner';
}

/** Mobile canAddItemsTo: anyone but a Viewer may add (a Submitter's links become proposals). */
export function canAddItemsTo(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return collection.accessRole !== 'viewer';
}
