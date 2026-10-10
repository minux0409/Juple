import type { ComponentType } from 'react';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { BellIcon } from '../icons/BellIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { SearchIcon } from '../icons/SearchIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UserIcon } from '../icons/UserIcon';

type GuideIcon = ComponentType<{ readonly color?: string; readonly size?: number }>;

/**
 * What a topic needs from the device before it is shown. `directShare` is the native shortcut module (Android today);
 * `homePin` is that AND a launcher that can pin Home-screen icons. Both come from useCollectionShortcutSupport - the
 * same source as the Collection menu - so the guide never advertises an action the menu would not offer.
 */
export type GuideRequirement = 'directShare' | 'homePin';

export interface GuideTopic {
  /** Locale keys: `guide.topics.<id>.title` and `.body` (paragraphs separated by a blank line). */
  readonly id: string;
  /** The whole topic is shown only when this holds. */
  readonly requires?: GuideRequirement;
  /** Extra paragraph (`guide.topics.<id>.<extra.key>`), shown only when its requirement holds. */
  readonly extra?: { readonly key: string; readonly requires: GuideRequirement };
}

export interface GuideSection {
  /** Locale keys: `guide.sections.<id>.title` and `.summary`. */
  readonly id: string;
  readonly icon: GuideIcon;
  readonly topics: readonly GuideTopic[];
}

/** The Help Guide, organized by what a person wants to do. Adding a feature means adding an entry here and its strings. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: 'save',
    icon: LinkIcon,
    topics: [
      { id: 'pasteShare' },
      { id: 'quickSave' },
      { id: 'review' },
      { id: 'androidShortcuts', requires: 'directShare' },
    ],
  },
  { id: 'homeArchive', icon: ArchiveIcon, topics: [{ id: 'home' }, { id: 'archive' }, { id: 'swipe' }] },
  { id: 'viewing', icon: SearchIcon, topics: [{ id: 'searchSort' }, { id: 'viewModes' }] },
  {
    id: 'collections',
    icon: FolderIcon,
    topics: [
      { id: 'createCollection' },
      { id: 'longPress', extra: { key: 'shortcut', requires: 'homePin' } },
      { id: 'manageLinks' },
    ],
  },
  {
    id: 'sharing',
    icon: PeopleIcon,
    topics: [{ id: 'publicLink' }, { id: 'invite' }, { id: 'roles' }, { id: 'joinRequests' }, { id: 'approvals' }],
  },
  { id: 'protection', icon: LockIcon, topics: [{ id: 'collectionLock' }, { id: 'accessPassword' }] },
  { id: 'notifications', icon: BellIcon, topics: [{ id: 'notificationCenter' }] },
  { id: 'trash', icon: TrashIcon, topics: [{ id: 'deleteRestore' }] },
  { id: 'account', icon: UserIcon, topics: [{ id: 'settings' }] },
];

export function findGuideSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find(section => section.id === id);
}
