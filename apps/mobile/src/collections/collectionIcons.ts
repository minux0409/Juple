import type { ComponentType } from 'react';
import { FolderIcon } from '../icons/FolderIcon';
import { GamepadIcon } from '../icons/GamepadIcon';
import { GlobeIcon } from '../icons/GlobeIcon';
import { HeartIcon } from '../icons/HeartIcon';
import { HomeIcon } from '../icons/HomeIcon';
import { LaptopIcon } from '../icons/LaptopIcon';
import { PlaneIcon } from '../icons/PlaneIcon';
import { ShoppingBagIcon } from '../icons/ShoppingBagIcon';
import { TagIcon } from '../icons/TagIcon';
import { UtensilsIcon } from '../icons/UtensilsIcon';

/**
 * The fixed set of decorative Collection icons - must exactly match the backend's CollectionIcon
 * enum member names (see backend/src/Juple.Domain/Collections/CollectionIcon.cs), since a
 * Collection's `icon` field (see collectionsApi.ts) is that enum's string name verbatim. Order here
 * is display order in the picker grid only - it has no bearing on the backend enum's own persisted
 * values (see CollectionIcon's remarks on that).
 */
export const COLLECTION_ICON_KEYS = [
  'Folder',
  'Heart',
  'Plane',
  'Gamepad',
  'Utensils',
  'ShoppingBag',
  'Home',
  'Laptop',
  'Globe',
  'Tag',
] as const;

export type CollectionIconKey = (typeof COLLECTION_ICON_KEYS)[number];

/** What a brand-new Collection gets when no icon is explicitly chosen - mirrors the backend's own default. */
export const DEFAULT_COLLECTION_ICON: CollectionIconKey = 'Folder';

interface CollectionIconComponentProps {
  readonly size?: number;
  readonly color?: string;
}

const COLLECTION_ICON_COMPONENTS: Readonly<Record<CollectionIconKey, ComponentType<CollectionIconComponentProps>>> = {
  Folder: FolderIcon,
  Heart: HeartIcon,
  Plane: PlaneIcon,
  Gamepad: GamepadIcon,
  Utensils: UtensilsIcon,
  ShoppingBag: ShoppingBagIcon,
  Home: HomeIcon,
  Laptop: LaptopIcon,
  Globe: GlobeIcon,
  Tag: TagIcon,
};

function isCollectionIconKey(icon: string): icon is CollectionIconKey {
  return (COLLECTION_ICON_KEYS as readonly string[]).includes(icon);
}

/**
 * Resolves a Collection's `icon` wire value (a plain string - see Collection.icon) to its icon
 * component. Falls back to the same default every brand-new Collection gets for any value this
 * build doesn't recognize (e.g. a newer server-only icon) - never guesses a meaning, just shows the
 * generic default, exactly like an unset icon would.
 */
export function resolveCollectionIconComponent(icon: string): ComponentType<CollectionIconComponentProps> {
  return isCollectionIconKey(icon) ? COLLECTION_ICON_COMPONENTS[icon] : COLLECTION_ICON_COMPONENTS[DEFAULT_COLLECTION_ICON];
}

/** Same fallback rule as resolveCollectionIconComponent, but returns the key itself - for seeding an icon picker's current selection from a Collection's wire value. */
export function resolveCollectionIconKey(icon: string): CollectionIconKey {
  return isCollectionIconKey(icon) ? icon : DEFAULT_COLLECTION_ICON;
}
