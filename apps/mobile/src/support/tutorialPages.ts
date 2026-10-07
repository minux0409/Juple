import type { ComponentType } from 'react';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { EyeOffIcon } from '../icons/EyeOffIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { FolderPlusIcon } from '../icons/FolderPlusIcon';
import { HomeIcon } from '../icons/HomeIcon';
import { ImageIcon } from '../icons/ImageIcon';
import { KeyIcon } from '../icons/KeyIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { SearchIcon } from '../icons/SearchIcon';
import { ShareIcon } from '../icons/ShareIcon';

type TutorialIcon = ComponentType<{ readonly color?: string; readonly size?: number }>;

export interface TutorialPageDefinition {
  /** Locale keys: `tutorial.pages.<id>.title` and `.description`. */
  readonly id: 'save' | 'collections' | 'find' | 'share' | 'lock';
  /** The big glyph of the page's illustration, and the small ones composed around it - Juple's own icons, no images. */
  readonly mainIcon: TutorialIcon;
  readonly chipIcons: readonly TutorialIcon[];
}

/** The tutorial: five short pages at most, bundled with the app (nothing is downloaded, so it works offline). */
export const TUTORIAL_PAGES: readonly TutorialPageDefinition[] = [
  { id: 'save', mainIcon: LinkIcon, chipIcons: [ShareIcon, CheckIcon] },
  { id: 'collections', mainIcon: FolderIcon, chipIcons: [FolderPlusIcon, CheckIcon] },
  { id: 'find', mainIcon: SearchIcon, chipIcons: [HomeIcon, ArchiveIcon, ImageIcon] },
  { id: 'share', mainIcon: PeopleIcon, chipIcons: [ShareIcon, CheckIcon] },
  { id: 'lock', mainIcon: LockIcon, chipIcons: [KeyIcon, EyeOffIcon] },
];
