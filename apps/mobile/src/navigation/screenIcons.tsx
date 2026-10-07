import { ScreenTitle, type ScreenTitleIcon } from '../components/ScreenTitle';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { BellIcon } from '../icons/BellIcon';
import { EditIcon } from '../icons/EditIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { GlobeIcon } from '../icons/GlobeIcon';
import { HomeIcon } from '../icons/HomeIcon';
import { InfoIcon } from '../icons/InfoIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { UserIcon } from '../icons/UserIcon';

/**
 * The one icon of each navigation item, shared by the bottom tab, the 내 페이지 row and the screen's
 * title - so a screen is recognised by the same glyph wherever it appears.
 */
export const screenIcons = {
  home: HomeIcon,
  archive: ArchiveIcon,
  collections: FolderIcon,
  collectionDetails: FolderIcon,
  notifications: BellIcon,
  profileEdit: EditIcon,
  myPage: UserIcon,
  friends: PeopleIcon,
  collectionLock: LockIcon,
  trash: TrashIcon,
  account: UserIcon,
  language: GlobeIcon,
  customerCenter: InfoIcon,
} as const satisfies Record<string, ScreenTitleIcon>;

/**
 * A stack screen's header title with its icon: `options={{ title, ...headerTitleWithIcon(icon, title) }}`.
 * `title` stays set as well (the back button's label and accessibility name).
 */
export function headerTitleWithIcon(icon: ScreenTitleIcon, title: string) {
  return { headerTitle: () => <ScreenTitle icon={icon} title={title} /> };
}
