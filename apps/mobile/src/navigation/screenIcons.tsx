import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { Platform } from 'react-native';
import { ScreenTitle, type ScreenTitleIcon } from '../components/ScreenTitle';
import { iosLeadingTitleOptions } from './sheetHeader';
import { ArchiveIcon } from '../icons/ArchiveIcon';
import { BellIcon } from '../icons/BellIcon';
import { EditIcon } from '../icons/EditIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { GlobeIcon } from '../icons/GlobeIcon';
import { HomeIcon } from '../icons/HomeIcon';
import { CreditCardIcon } from '../icons/CreditCardIcon';
import { DownloadIcon } from '../icons/DownloadIcon';
import { HelpIcon } from '../icons/HelpIcon';
import { InfoIcon } from '../icons/InfoIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { LockIcon } from '../icons/LockIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { ContrastIcon } from '../icons/ContrastIcon';
import { UserIcon } from '../icons/UserIcon';
import { UserMinusIcon } from '../icons/UserMinusIcon';

/**
 * The one icon of each navigation item, shared by the bottom tab, the 내 페이지 row and the screen's
 * title - so a screen is recognised by the same glyph wherever it appears.
 */
export const screenIcons = {
  home: HomeIcon,
  archive: ArchiveIcon,
  collections: FolderIcon,
  collectionDetails: FolderIcon,
  collectionShare: ShareIcon,
  /** One link: reviewing a new one, another member's link in a shared Collection, the links I proposed. */
  link: LinkIcon,
  notifications: BellIcon,
  profileEdit: EditIcon,
  myPage: UserIcon,
  friends: PeopleIcon,
  collectionLock: LockIcon,
  trash: TrashIcon,
  account: UserIcon,
  deleteAccount: UserMinusIcon,
  language: GlobeIcon,
  appearance: ContrastIcon,
  customerCenter: InfoIcon,
  help: HelpIcon,
  subscription: CreditCardIcon,
  dataExport: DownloadIcon,
  notices: BellIcon,
} as const satisfies Record<string, ScreenTitleIcon>;

/**
 * A stack screen's header title with its icon: `options={{ title, ...headerTitleWithIcon(icon, title) }}`.
 * `title` stays set as well (the back button's label and accessibility name). Android: the native toolbar title (start-aligned
 * after its arrow). iOS: the same row as the bar's leading item next to the arrow - iOS would otherwise center it.
 */
export function headerTitleWithIcon(icon: ScreenTitleIcon, title: string): NativeStackNavigationOptions {
  const element = <ScreenTitle icon={icon} title={title} />;
  return Platform.OS === 'ios' ? iosLeadingTitleOptions(element) : { headerTitle: () => element };
}
