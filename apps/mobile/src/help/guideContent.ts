import type { ComponentType } from 'react';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { BellIcon } from '../icons/BellIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { CreditCardIcon } from '../icons/CreditCardIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { SearchIcon } from '../icons/SearchIcon';
import { ShareIcon } from '../icons/ShareIcon';
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
  { id: 'homeArchive', icon: ArchiveIcon, topics: [{ id: 'home' }, { id: 'archive' }, { id: 'linkDetails' }, { id: 'swipe' }] },
  { id: 'viewing', icon: SearchIcon, topics: [{ id: 'searchSort' }, { id: 'viewModes' }] },
  // Long-press starts multi-selection (links and Collections); the bottom bar's actions are explained here once.
  { id: 'selection', icon: CheckIcon, topics: [{ id: 'selectLinks' }, { id: 'selectCollections' }] },
  {
    id: 'collections',
    icon: FolderIcon,
    topics: [
      { id: 'createCollection' },
      { id: 'favorites' },
      { id: 'homeShortcut', requires: 'homePin' },
      { id: 'manageLinks' },
    ],
  },
  {
    id: 'sharing',
    icon: ShareIcon,
    topics: [{ id: 'publicLink' }, { id: 'invite' }, { id: 'roles' }, { id: 'joinRequests' }, { id: 'approvals' }, { id: 'comments' }],
  },
  { id: 'protection', icon: LockIcon, topics: [{ id: 'collectionLock' }, { id: 'accessPassword' }] },
  { id: 'friends', icon: PeopleIcon, topics: [{ id: 'friends' }, { id: 'blockReport' }] },
  { id: 'notifications', icon: BellIcon, topics: [{ id: 'notificationCenter' }, { id: 'notices' }] },
  { id: 'trash', icon: TrashIcon, topics: [{ id: 'deleteRestore' }] },
  {
    id: 'membership',
    icon: CreditCardIcon,
    topics: [{ id: 'trialPeriod' }, { id: 'plansBilling' }, { id: 'restorePurchases' }, { id: 'cancelSubscription' }, { id: 'afterTrial' }],
  },
  {
    id: 'account',
    icon: UserIcon,
    topics: [{ id: 'profilePhoto' }, { id: 'settings' }, { id: 'legalDocs' }, { id: 'deleteAccount' }, { id: 'useOnWeb' }],
  },
];

export function findGuideSection(id: string): GuideSection | undefined {
  return GUIDE_SECTIONS.find(section => section.id === id);
}
